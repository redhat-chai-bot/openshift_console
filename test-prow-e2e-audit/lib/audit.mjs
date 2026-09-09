import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ENTITY_MAP = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function decodeXML(value = '') {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => ENTITY_MAP[entity]);
}

function attributes(source = '') {
  return Object.fromEntries(
    [...source.matchAll(/([\w:-]+)=(?:"([^"]*)"|'([^']*)')/g)].map((match) => [
      match[1], decodeXML(match[2] ?? match[3] ?? ''),
    ]),
  );
}

export function classifyAttempts(attempts) {
  const statuses = new Set(attempts);
  if (statuses.has('passed') && (statuses.has('failed') || statuses.has('error'))) return 'flaky';
  if (statuses.has('failed') || statuses.has('error')) return 'failed';
  if (statuses.has('skipped')) return 'skipped';
  return 'passed';
}

export function parseJUnit(xml, source = 'current') {
  if (!/<testsuites?\b/.test(xml)) throw new Error(`${source}: not a JUnit XML document`);

  const timestamp = xml.match(/<testsuite\b[^>]*\btimestamp=(?:"([^"]*)"|'([^']*)')/)?.slice(1).find(Boolean);
  const grouped = new Map();
  const casePattern = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let match;
  while ((match = casePattern.exec(xml))) {
    const attrs = attributes(match[1]);
    const body = match[2] ?? '';
    const key = `${attrs.classname ?? ''}\u0000${attrs.name ?? 'unnamed test'}`;
    const status = /<failure\b/.test(body) ? 'failed'
      : /<error\b/.test(body) ? 'error'
        : /<skipped\b/.test(body) ? 'skipped'
          : 'passed';
    const item = grouped.get(key) ?? { name: attrs.name ?? 'unnamed test', classname: attrs.classname ?? '', attempts: [] };
    item.attempts.push(status);
    grouped.set(key, item);
  }
  if (grouped.size === 0) throw new Error(`${source}: contains no test cases`);

  const tests = [...grouped.values()].map((item) => ({ ...item, outcome: classifyAttempts(item.attempts) }));
  const counts = { total: tests.length, passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const test of tests) counts[test.outcome]++;
  return { source, timestamp: timestamp ?? null, counts, tests };
}

async function findXMLFiles(directory) {
  if (!directory) return [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findXMLFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.xml') ? [entryPath] : [];
  }));
  return files.flat();
}

export async function loadRuns(currentFile, historyDirectory) {
  const current = parseJUnit(await readFile(currentFile, 'utf8'), path.basename(currentFile));
  const history = [];
  for (const file of await findXMLFiles(historyDirectory)) {
    if (path.resolve(file) === path.resolve(currentFile)) continue;
    history.push(parseJUnit(await readFile(file, 'utf8'), path.relative(historyDirectory, file)));
  }
  return [...history, current].sort((a, b) => (a.timestamp ?? a.source).localeCompare(b.timestamp ?? b.source));
}

export function topFlakyTests(runs, limit = 10) {
  const aggregate = new Map();
  for (const run of runs) {
    for (const test of run.tests) {
      const key = `${test.classname}\u0000${test.name}`;
      const item = aggregate.get(key) ?? { name: test.name, classname: test.classname, flakyRuns: 0, totalRuns: 0 };
      item.totalRuns++;
      if (test.outcome === 'flaky') item.flakyRuns++;
      aggregate.set(key, item);
    }
  }
  return [...aggregate.values()]
    .filter((item) => item.flakyRuns > 0)
    .sort((a, b) => b.flakyRuns - a.flakyRuns || b.totalRuns - a.totalRuns || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export async function loadBugs(file) {
  if (!file) return [];
  const document = JSON.parse(await readFile(file, 'utf8'));
  const bugs = Array.isArray(document) ? document : document.bugs;
  if (!Array.isArray(bugs)) throw new Error('bugs input must be an array or an object with a bugs array');
  return bugs.map((bug) => {
    if (!bug.key || !bug.url) throw new Error('each bug requires key and url');
    const url = new URL(bug.url);
    if (url.protocol !== 'https:') throw new Error(`bug ${bug.key} must use an HTTPS URL`);
    return { key: String(bug.key), url: url.toString(), summary: String(bug.summary ?? '') };
  });
}

export function createAudit(runs, bugs, generatedAt = new Date().toISOString()) {
  if (runs.length === 0) throw new Error('no JUnit runs were supplied');
  return {
    status: 'complete', generatedAt, runs: runs.map(({ source, timestamp, counts }) => ({ source, timestamp, ...counts })),
    topFlakyTests: topFlakyTests(runs), newBugs: bugs,
  };
}

export function createFailureAudit(error, generatedAt = new Date().toISOString()) {
  return { status: 'incomplete', generatedAt, error: String(error.message ?? error), runs: [], topFlakyTests: [], newBugs: [] };
}

function renderTrendRows(runs) {
  return runs.map((run) => `<tr><td>${escapeHTML(run.timestamp ?? run.source)}</td><td>${run.total}</td><td>${run.passed}</td><td>${run.failed}</td><td>${run.flaky}</td><td>${run.skipped}</td></tr>`).join('');
}

export function renderHTML(audit) {
  const title = 'Console CI E2E Reliability Audit';
  const failed = audit.status === 'incomplete';
  const flakyRows = audit.topFlakyTests.length
    ? audit.topFlakyTests.map((test) => `<tr><td>${escapeHTML(test.name)}</td><td>${escapeHTML(test.classname)}</td><td>${test.flakyRuns}</td><td>${test.totalRuns}</td></tr>`).join('')
    : '<tr><td colspan="4">No flaky tests in the supplied runs.</td></tr>';
  const bugRows = audit.newBugs.length
    ? audit.newBugs.map((bug) => `<li><a href="${escapeHTML(bug.url)}">${escapeHTML(bug.key)}</a>${bug.summary ? ` — ${escapeHTML(bug.summary)}` : ''}</li>`).join('')
    : '<li>No new bug tickets were supplied.</li>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px system-ui,sans-serif;margin:2rem;color:#151515}table{border-collapse:collapse;width:100%;max-width:1000px}th,td{border:1px solid #d2d2d2;padding:.5rem;text-align:left}th{background:#f0f0f0}.bad{color:#c9190b;font-weight:700}.meta{color:#555}</style></head>
<body><h1>${title}</h1><p class="meta">Generated ${escapeHTML(audit.generatedAt)}</p>${failed ? `<p class="bad">Report inputs were incomplete: ${escapeHTML(audit.error)}</p>` : ''}
<h2>Pass/fail trend</h2><table><thead><tr><th>Run</th><th>Total</th><th>Passed</th><th>Failed</th><th>Flaky</th><th>Skipped</th></tr></thead><tbody>${renderTrendRows(audit.runs)}</tbody></table>
<h2>Top 10 flaky tests</h2><table><thead><tr><th>Test</th><th>Suite</th><th>Flaky runs</th><th>Total runs</th></tr></thead><tbody>${flakyRows}</tbody></table>
<h2>New bug tickets</h2><ul>${bugRows}</ul></body></html>`;
}

export async function writeAudit(outputDirectory, audit) {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, 'e2e-reliability-audit.json'), `${JSON.stringify(audit, null, 2)}\n`),
    writeFile(path.join(outputDirectory, 'e2e-reliability-audit.html'), renderHTML(audit)),
  ]);
}

export async function postSlack(webhookFile, audit, reportURL) {
  if (!webhookFile) return { requested: false, delivered: false };
  const webhook = (await readFile(webhookFile, 'utf8')).trim();
  if (!webhook.startsWith('https://')) throw new Error('Slack webhook must use HTTPS');
  const current = audit.runs.at(-1);
  const text = `${audit.status === 'complete' ? 'Console CI E2E reliability audit' : 'Console CI E2E reliability audit (incomplete)'}: ${current ? `${current.passed} passed, ${current.failed} failed, ${current.flaky} flaky.` : audit.error}${reportURL ? ` Report: ${reportURL}` : ''}`;
  const response = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!response.ok) throw new Error(`Slack delivery failed with HTTP ${response.status}`);
  return { requested: true, delivered: true };
}
