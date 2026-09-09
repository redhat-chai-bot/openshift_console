import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyAttempts, createAudit, createFailureAudit, loadBugs, loadRuns, parseJUnit, renderHTML, writeAudit } from '../lib/audit.mjs';

const fixtures = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures');

test('classifies retry attempts without treating plain failures as flaky', () => {
  assert.equal(classifyAttempts(['failed', 'passed']), 'flaky');
  assert.equal(classifyAttempts(['error', 'passed']), 'flaky');
  assert.equal(classifyAttempts(['failed']), 'failed');
  assert.equal(classifyAttempts(['skipped']), 'skipped');
});

test('aggregates trends and ranks flaky tests from JUnit history', async () => {
  const runs = await loadRuns(path.join(fixtures, 'current.xml'), path.join(fixtures, 'history'));
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[1].counts, { total: 4, passed: 1, failed: 1, flaky: 1, skipped: 1 });
  const audit = createAudit(runs, await loadBugs(path.join(fixtures, 'bugs.json')), '2026-09-09T14:00:00Z');
  assert.equal(audit.topFlakyTests[0].name, 'flaky & retry');
  assert.equal(audit.topFlakyTests[0].flakyRuns, 2);
  assert.equal(audit.newBugs[0].key, 'EXAMPLE-123');
});

test('escapes test and bug content in standalone HTML', () => {
  const html = renderHTML({ status: 'complete', generatedAt: 'now', runs: [], topFlakyTests: [{ name: '<script>', classname: 'x&y', flakyRuns: 1, totalRuns: 1 }], newBugs: [{ key: 'BUG<1>', url: 'https://example.test/?a=1&b=2', summary: '<unsafe>' }] });
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /x&amp;y/);
  assert.match(html, /BUG&lt;1&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('writes an incomplete report when JUnit input is malformed', async () => {
  assert.throws(() => parseJUnit('<html>bad input</html>', 'bad.xml'), /not a JUnit/);
  const output = await mkdtemp(path.join(os.tmpdir(), 'e2e-audit-'));
  try {
    const audit = createFailureAudit(new Error('bad <input>'), '2026-09-09T14:00:00Z');
    await writeAudit(output, audit);
    const html = await readFile(path.join(output, 'e2e-reliability-audit.html'), 'utf8');
    assert.match(html, /Report inputs were incomplete/);
    assert.match(html, /bad &lt;input&gt;/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
