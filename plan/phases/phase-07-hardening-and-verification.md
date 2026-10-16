# Phase 7 — Security, reliability, and full verification

## Goal

Prove the P0 product is safe, truthful, robust, and complete before public deployment and demo recording.

## Dependencies

- Phases 0-6 exit gates pass.
- Test accounts and isolated test data are available.
- Real integration contract checks can run without impacting production users.

## Work

1. Run formatting, lint, typecheck, build, unit tests, and integration tests. Add any missing scripts required by the source specs.
2. Run actual MCP protocol tests for initialize, exact negotiated version, notifications/initialized, tools/list, authenticated tools/call, valid error envelopes, and public Streamable HTTP behavior.
3. Verify auth and data isolation across users, all ownership checks, RLS, idempotent onboarding/handoff, deletion/export behavior, and absence of client identity trust.
4. Verify live Composio success, zero-result success, missing capability, invalid response, timeout, outage, and expired-result refresh. Assert failure never produces an option, link, or success state.
5. Run all PRD end-to-end scenarios, including multi-repair/group budget, ambiguous returning-user update, invalid URL, urgent safety trigger, no-estimate behavior, and user-reported status provenance.
6. Verify every MCP App View state and host action in Inspector and Manufact Cloud Chat; inspect accessibility, CSP, asset paths, host rejection, and runtime errors.
7. Scan built View assets, logs, error payloads, screenshots, examples, and repository for secret leakage, fictional user/provider content, starter tool names, and accidental fallback paths.
8. Verify request size/rate limits, timeouts, cancellation behavior where supported, safe logging, privacy/minimum-disclosure rules, and data deletion.
9. Update README, `.env.example`, migration/setup instructions, and operational troubleshooting from the actual implementation.
10. Record exact versions, protocol test result, discovered Taskrabbit tools, capabilities tested live, test outcomes, and known unverified boundaries.

## Deliverables

- Completed P0 verification checklist and test results.
- Security/privacy and no-dummy-data review notes.
- Accurate local setup and troubleshooting documentation.
- Explicit list of any defects or unverified boundaries; do not mark them passed.

## Exit gate

- All P0 PRD criteria and technical quality gates pass.
- Protocol, OAuth, isolation, View, and real integration behavior are verified end to end.
- All failure paths remain truthful and do not substitute fixtures.
- No leaked secret or shipped starter functionality remains.
- Known limitations do not invalidate the intended demo or security boundary.

## Do not do in this phase

- Do not claim a test passed unless it ran against the target behavior.
- Do not solve a failing live integration check by switching to mock data.
- Do not deploy publicly until the phase gate is met.

