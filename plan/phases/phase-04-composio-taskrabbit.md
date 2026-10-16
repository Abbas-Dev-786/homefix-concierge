# Phase 4 — Live Taskrabbit through Composio

## Goal

Connect HomeFix to the actual Taskrabbit MCP capabilities available through Composio and normalize only real provider responses.

## Dependencies

- Phase 3 tool/domain contracts exist.
- Composio project/key and a configured Taskrabbit connection/session are available in server environment.
- Use isolated test doubles only in tests; a live contract check uses the configured real session.

## Work

1. Inspect current Composio SDK and MCP session documentation/types before implementing the client.
2. Create a per-user Composio session identity derived from the verified Supabase user ID. Do not use a shared global session identity.
3. Discover the actual Taskrabbit tool list and schemas at runtime or through the supported Composio discovery path. Record exact live tools and map them to logical capabilities: list services, availability/pricing/scoping, and deep-link generation.
4. Fail capability setup visibly when a required capability is absent or its schema is unsupported. Do not guess tool names, IDs, fields, or response formats.
5. Implement a typed adapter for discovery, service availability/pricing/scoping lookup, and pre-filled link creation. Add finite timeouts, cancellation where supported, retries only for safe/idempotent operations, and normalized integration errors.
6. Sanitize and validate provider output before persistence or rendering. Preserve source, retrieval time, returned fields, and unknown values; do not infer missing data.
7. Enforce freshness: an option is handoff-eligible only if retrieval age is strictly less than 15 minutes. At or beyond 15 minutes, perform a new live lookup before link generation; if refresh fails, do not produce a link.
8. Validate generated links as HTTPS on explicitly allowlisted Taskrabbit hostnames. Reject malformed, lookalike, or unexpected external hosts.
9. Implement capability status with truthful unavailable/error/available states. A successful empty provider response remains an empty live result.
10. Add tests with isolated provider fakes for schema variants, timeouts, malformed data, missing capabilities, empty results, stale data, invalid URLs, and error normalization; run a live contract check with the configured Composio session.

## Deliverables

- Composio client/session setup and per-user identity mapping.
- Recorded discovered Taskrabbit tools/schemas and logical capability map.
- Typed adapter and normalized provider response/error models.
- Live contract-check evidence and isolated adapter tests.

## Exit gate

- The configured real session discovers and invokes the actual required Taskrabbit capabilities.
- Provider results show provenance and retrieval timestamps and contain no invented values.
- Missing/failed capabilities produce actionable errors, no option, no handoff, and no fallback fixtures.
- Exactly-15-minute-old results are expired; a fresh live result is required before link generation.
- Unsafe or invalid Taskrabbit URLs never reach an active View link.

## Do not do in this phase

- Do not store a user token or Composio secret in the browser/View.
- Do not construct Taskrabbit booking URLs locally when Composio link generation fails.
- Do not turn a provider capability into a claim that a booking was confirmed.

