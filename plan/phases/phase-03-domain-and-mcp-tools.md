# Phase 3 — HomeFix domain and MCP tool contract

## Goal

Implement durable repair workflow rules and expose them through authenticated, typed HomeFix MCP tools before connecting provider behavior.

## Dependencies

- Phase 2 migrations, authenticated repositories, and onboarding pass.
- Phase 1 server protocol gate remains passing.

## Work

1. Define typed domain models for maintenance requests, intake groups, service searches/options, booking handoffs, maintenance events, follow-ups if P0 scope requires them, source provenance, and normalized errors.
2. Implement the canonical maintenance and handoff state machines from `docs/PRD.md` and `docs/TECHNICAL_SPEC.md`; enforce transitions in server-side services.
3. Add remaining migrations and repository methods for repair requests/groups, searches, options, handoffs, and audit events. Scope every query by authenticated household.
4. Implement idempotency for retryable mutations and duplicate clicks. Record transitions with source and timestamps; never treat an opened link as a booking.
5. Register HomeFix MCP tools from the technical spec: context/dashboard, household/profile, repair/group CRUD, supported-service lookup/status interfaces, option compare, handoff prepare/open, outcome reporting, and maintenance status updates. Provider-facing tools may return explicit unavailable status until Phase 4; they must not return fabricated options.
6. Define narrow Zod input/output schemas, validate all inputs, and return model-readable `content` plus matching `structuredContent` for every View-bound tool.
7. Add typed errors for unauthenticated, forbidden, invalid input/state, not found, conflict/idempotency, integration unavailable, and unexpected failures. Do not leak stack traces, tokens, claims, or raw provider payloads.
8. Add unit and integration tests for state transitions, ownership, duplicate handling, matching ambiguity, grouping, budget rules, and safe errors.

## Deliverables

- Domain types, services, repositories, migrations, state machine, and audit events.
- Authenticated MCP tool registry and tool descriptions.
- Input/output schemas and sanitized result/error envelopes.
- Tests covering state and security invariants.

## Exit gate

- All state transitions follow the canonical vocabularies and cannot be bypassed by model arguments.
- Mutations and reads require verified identity and household membership.
- Tool schemas reject malformed or unauthorized inputs and conform to the MCP View output contract.
- Durable state survives server restart and cannot be duplicated by an idempotent retry.
- Provider tools clearly report unavailable until backed by real Composio calls; there is no product fixture path.

## Do not do in this phase

- Do not add model orchestration inside the HomeFix server.
- Do not report provider price, availability, or booking success without provider evidence.
- Do not add a generic SQL tool or client-provided household identifier.

