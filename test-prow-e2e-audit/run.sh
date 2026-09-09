#!/usr/bin/env bash
# Prow entrypoint: preserve the E2E result but always publish the audit artifacts.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="${ARTIFACT_DIR:-/tmp/artifacts}"
AUDIT_DIR="${ARTIFACT_DIR}/e2e-reliability-audit"

# ci-operator accepts only UTC cron schedules. The release configuration invokes
# this job at both possible UTC offsets; this guard makes the costly E2E run
# happen exactly once, at 09:00 America/New_York across DST transitions.
if [[ "${AUDIT_ENFORCE_EASTERN_SCHEDULE:-false}" == "true" ]] && [[ "$(TZ=America/New_York date +%u:%H)" != "2:09" ]]; then
  echo "Skipping audit outside Tuesday 09:00 America/New_York."
  exit 0
fi

set +e
"${REPO_ROOT}/test-prow-e2e.sh"
e2e_status=$?
set -e

args=(--current "${ARTIFACT_DIR}/junit-playwright.xml" --output-dir "${AUDIT_DIR}")
[[ -n "${AUDIT_HISTORY_DIR:-}" ]] && args+=(--history-dir "${AUDIT_HISTORY_DIR}")
if [[ -n "${AUDIT_BUGS_FILE:-}" && -f "${AUDIT_BUGS_FILE}" ]]; then
  args+=(--bugs-file "${AUDIT_BUGS_FILE}")
elif [[ -n "${AUDIT_BUGS_FILE:-}" ]]; then
  echo "Audit bug input is not mounted; publishing without new-bug links."
fi
if [[ -n "${AUDIT_SLACK_WEBHOOK_FILE:-}" && -f "${AUDIT_SLACK_WEBHOOK_FILE}" ]]; then
  args+=(--slack-webhook-file "${AUDIT_SLACK_WEBHOOK_FILE}")
elif [[ -n "${AUDIT_SLACK_WEBHOOK_FILE:-}" ]]; then
  echo "Audit Slack webhook is not mounted; skipping Slack delivery."
fi

if [[ -z "${AUDIT_REPORT_URL:-}" && -n "${BUILD_ID:-}" && -n "${JOB_NAME:-}" ]]; then
  AUDIT_REPORT_URL="https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/logs/${JOB_NAME}/${BUILD_ID}/artifacts/e2e-gcp-console-audit/test/artifacts/e2e-reliability-audit/e2e-reliability-audit.html"
fi
[[ -n "${AUDIT_REPORT_URL:-}" ]] && args+=(--report-url "${AUDIT_REPORT_URL}")

set +e
node "${REPO_ROOT}/test-prow-e2e-audit/audit.mjs" "${args[@]}"
audit_status=$?
set -e

if [[ $e2e_status -ne 0 ]]; then
  exit "$e2e_status"
fi
exit "$audit_status"
