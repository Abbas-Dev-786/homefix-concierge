# Phase 4 evidence — Composio Taskrabbit

## Local implementation status

Implemented locally on 2026-10-16.

- Added a per-verified-user Composio Tool Router session using the documented `taskrabbit_mcp` toolkit.
- Discovers the live MCP tool list and maps the three required capabilities: supported services, availability/pricing/scoping, and booking deep links.
- Supports explicit `TASKRABBIT_TOOL_MAP_JSON` mappings and marks ambiguous or unsupported capabilities unavailable.
- Normalizes only returned provider fields, preserves retrieval timestamps, applies a strict less-than-15-minute freshness rule, and validates HTTPS Taskrabbit links against an exact hostname allowlist.
- Added bounded outbound calls, sanitized integration errors, and adapter tests for freshness, normalization, missing fields, empty results, and unsafe URLs.

## Local checks

`npm run typecheck` passed.

`npm run test:unit` passed: 9 tests.

`npm run build` passed.

## External gate still required

The live Composio session and real Taskrabbit calls must be exercised after this code is deployed with the configured server-only `COMPOSIO_API_KEY`, Taskrabbit connection, and exact tool map if runtime discovery is ambiguous. The repository does not claim Phase 4’s live exit gate from local compilation or test doubles.
