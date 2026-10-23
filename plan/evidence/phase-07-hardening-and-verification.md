# Phase 7 evidence — Security, reliability, and full verification

## Local implementation

Implemented locally on 2026-10-19.

- Added authenticated `export_household_data` and explicitly confirmed `delete_household_data` tools. Household deletion uses the existing database cascade and is scoped from verified OAuth identity.
- Added server-side MCP request-size enforcement, per-address sliding-window rate limiting, configurable outbound persistence timeout propagation, and bounded/redacted persisted activity payloads.
- Added the read-only `get_current_date_time` tool with validated IANA timezone input and deterministic timezone formatting.
- Hardened Composio Taskrabbit execution handling: provider calls now have a separate configurable execution timeout, abort signal propagation, explicit failed-result handling, and MCP-envelope unwrapping.
- Added `npm run verify:security` to scan compiled View assets for server-only variable names, credential prefixes, bearer tokens, and JWT-shaped values.
- Pinned the protocol verifier's initialize request to exactly MCP `2025-11-25`; it checks the initialized lifecycle, tool list, View binding, readiness, consent route, and unauthenticated protection.

## Checks run

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | Passed | `mcp-use` reported no type errors. |
| `npm run build` | Passed | Built server and `homefix-dashboard` View. |
| `npm run test:unit` | Passed | 26 tests passed, including scope isolation, idempotency, state transitions, expiry, provider failure normalization, Composio response unwrapping/timeout handling, export/deletion scope, redaction, rate limiting, current date/time formatting, and preflight coverage for service listing, service search, and stale handoff refreshes. |
| `npm run verify:protocol` | Passed locally | Exact negotiated version `2025-11-25`; initialized notification sent; oversized request rejected with HTTP 413; 21 tools including `get_current_date_time`; View resource `ui://views/homefix-dashboard.html`; readiness HTTP 200; consent HTTP 200; unauthenticated dashboard rejected. |
| `npm run verify:security` | Passed | 4 compiled View assets scanned; no forbidden secret patterns found. |
| `npm run verify:deployed` | Passed against configured public endpoint | Public endpoint negotiated `2025-11-25`, readiness HTTP 200, consent HTTP 200, and rejected unauthenticated protected tools. The endpoint currently contains the previous 18-tool deployment, so this is not evidence that the new Phase 7 source is deployed. |

## Explicitly unverified boundaries

- Authenticated local protocol execution was not completed: the ignored local OAuth access token was expired and rejected by the local server. No token value was printed or committed.
- The two-user deployed isolation verifier was not run because `PHASE23_TEST_ACCESS_TOKEN_A` and `PHASE23_TEST_ACCESS_TOKEN_B` are unset. RLS and live Supabase cascade behavior therefore remain deployment checks.
- Live Composio Taskrabbit success, zero-result, timeout, outage, capability discovery, and refreshed-expiry behavior remain contract-tested with isolated doubles; no new live provider call was made in this phase.
- Inspector/Manufact Cloud Chat rendering, external-link host action acceptance, accessibility inspection, and runtime/CSP inspection remain host-boundary checks from the Phase 6 evidence and must be rerun after deploying the current source.
- No public deployment was performed in Phase 7. Publishing the hardened build and rerunning the authenticated public walkthrough belongs to Phase 8.
- Repository pattern review found only intentional `ak_`/`ck_` examples and test/validation literals in source and isolated tests; no credential value was found. The compiled View scan is the enforceable shipping check.
- No standalone formatter/linter is installed in the repository; typecheck, build, tests, protocol, and security checks are the implemented quality gates. This is not claimed as a formatter/linter pass.

Phase 7 local hardening is complete. The full phase exit gate remains pending the explicitly listed authenticated, live-provider, host, and post-deployment checks.
