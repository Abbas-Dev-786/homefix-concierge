# Phase 6 evidence — HomeFix MCP App View

## Local implementation status

Implemented locally on 2026-10-19.

- Replaced the temporary compatibility View with `views/homefix-dashboard/`.
- Bound `open_homefix_dashboard` to the View with a matching `outputSchema` and `structuredContent` contract.
- Exported typed HomeFix tool references for View bridge calls.
- Added explicit onboarding, home-profile editing, repair intake, open repairs, history, live Taskrabbit options, deterministic comparison, validated handoff preparation, host-mediated external opening, user-reported outcomes, and persisted activity display.
- Added pending, error, empty, unavailable, stale/provider-result messaging, host-link rejection handling, and no-household onboarding states.
- Kept durable state in server/Supabase tools and limited View state to drafts, selections, panels, and transient handoff status.
- Removed the compatibility View and its probe from the active product surface.

## Checks

- `npm run typecheck`: passed.
- `npm run build`: passed; registry contains `homefix-dashboard`.
- `npm run test:unit`: passed, 14 tests.
- `npm run verify:protocol`: passed with MCP `2025-11-25`, 18 tools, `ui://views/homefix-dashboard.html`, readiness HTTP 200, OAuth consent HTTP 200, and unauthenticated dashboard rejection.
- `npm run verify:deployed` was updated to validate `open_homefix_dashboard`; it requires the current deployed endpoint and is not claimed as passed by this local implementation pass.

## Remaining host boundary

The local screenshot smoke test could not authenticate the View because the locally stored temporary OAuth token was rejected by the running Inspector endpoint. No host-rendering success is claimed from that failed attempt. Refresh a temporary token with `npm run oauth:token`, run the authenticated Inspector/Manufact Cloud Chat walkthrough, and record the resulting screenshot and host-action checks here after redeployment.
