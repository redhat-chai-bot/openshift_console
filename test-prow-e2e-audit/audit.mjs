#!/usr/bin/env node
import path from 'node:path';
import { createAudit, createFailureAudit, loadBugs, loadRuns, postSlack, writeAudit } from './lib/audit.mjs';

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const current = option('--current');
const outputDir = option('--output-dir');
const historyDir = option('--history-dir');
const bugsFile = option('--bugs-file');
const slackWebhookFile = option('--slack-webhook-file');
const reportURL = option('--report-url');

if (!current || !outputDir) {
  console.error('usage: audit.mjs --current <junit.xml> --output-dir <directory> [--history-dir <directory>] [--bugs-file <bugs.json>] [--slack-webhook-file <file>] [--report-url <https-url>]');
  process.exitCode = 2;
} else {
  let audit;
  try {
    audit = createAudit(await loadRuns(current, historyDir), await loadBugs(bugsFile));
  } catch (error) {
    audit = createFailureAudit(error);
    process.exitCode = 1;
  }
  try {
    await writeAudit(outputDir, audit);
    await postSlack(slackWebhookFile, audit, reportURL);
  } catch (error) {
    console.error(`Audit publication failed: ${error.message}`);
    process.exitCode = 1;
  }
  console.log(`Wrote ${path.join(outputDir, 'e2e-reliability-audit.html')}`);
}
