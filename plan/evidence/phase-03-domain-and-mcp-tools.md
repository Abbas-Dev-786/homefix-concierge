# Phase 3 evidence — HomeFix domain and MCP tool contract

Status: implementation complete locally; live database transition and authenticated integration verification remain pending.

## Implemented

- Added versioned SQL migration for intake groups, maintenance requests, service searches, service options, booking handoffs, and maintenance events.
- Added household-scoped RLS policies and indexes for domain tables.
- Added canonical maintenance states and server-side transition validation.
- Added idempotent repair request creation using household-scoped idempotency keys.
- Added sanitized, typed HomeFix errors for authentication, ownership, invalid state/input, persistence, and unavailable provider conditions.
- Added authenticated MCP tools for household context, repair groups, repair requests, request listing, status updates, option comparison, handoff-open recording, and user-reported outcomes.
- Added provider-facing tool contracts that explicitly return unavailable status until the live Composio Taskrabbit adapter is implemented in Phase 4.
- No provider fixtures, fabricated options, booking URLs, or success paths were added.

## Local evidence

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run verify:protocol`: passed with 17 discovered tools, MCP `2025-11-25`, persistence readiness configured, and unauthenticated protected tools rejected.
- `npm run test:unit`: passed with repository idempotency, legal state transitions, handoff state progression, repeated handoff-open behavior, and truthful user-reported outcomes.

## Required activation

Apply `supabase/migrations/20261016001000_phase3_domain.sql` after the Phase 2 migration. Then run `npm run verify:phase2-3` against the deployed endpoint to verify authenticated ownership, idempotent retries, legal status transitions, and durable state with real isolated test users. Live Taskrabbit behavior remains intentionally unavailable until Phase 4.
