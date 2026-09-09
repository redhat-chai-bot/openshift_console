# Console CI E2E reliability audit

`run.sh` runs the existing Playwright Prow entrypoint and always produces these artifacts:

- `e2e-reliability-audit.html` — standalone report with pass/fail trend, top ten flaky tests, and new-bug links.
- `e2e-reliability-audit.json` — the same normalized data for automation.

The audit consumes Prow-compatible Playwright JUnit. A test is **flaky** only when the same test has both a failing/error attempt and a passing retry in a single run. Historical rankings are calculated from the supplied JUnit files; no Jira or artifact-store credentials are embedded in this repository.

## Required external inputs

| Input | Contract | Operator action |
| --- | --- | --- |
| `AUDIT_HISTORY_DIR` | Read-only directory containing one or more prior `junit-playwright.xml` files. | Provision the history materializer/read access and mount the resulting directory in the periodic job. |
| `AUDIT_BUGS_FILE` | JSON array (or `{ "bugs": [...] }`) whose entries have `key`, HTTPS `url`, and optional `summary`. | Provision the approved Jira query/integration to write only tickets newly returned since the prior audit. The repository does not assume a Jira project, component, or credentials. Missing input is reported and does not prevent artifact generation. |
| `AUDIT_SLACK_WEBHOOK_FILE` | A file containing an HTTPS incoming-webhook URL for the QE Console CI destination. | Create and mount the secret in `test-credentials`; keep its value out of Git. Missing input is reported and does not prevent artifact generation. |
| `AUDIT_REPORT_URL` | Public URL of the uploaded HTML artifact. | Set this if the Prow job wrapper has a stable artifact URL; Slack delivery omits the link otherwise. |

ci-operator accepts UTC-only cron fields. The release configuration therefore schedules `0 13,14 * * 2`, and `run.sh` skips the non-09:00 invocation using `TZ=America/New_York`. The costly E2E audit consequently runs exactly once each Tuesday at 09:00 Eastern across DST transitions. Until the history/Jira/Slack integrations are provisioned, the audit still publishes a failure-safe HTML/JSON artifact from the current run, but cannot claim historical trends, ticket discovery, or Slack delivery.

## Local usage

```bash
node audit.mjs --current test/fixtures/current.xml --history-dir test/fixtures/history --bugs-file test/fixtures/bugs.json --output-dir /tmp/e2e-audit
npm test
```
