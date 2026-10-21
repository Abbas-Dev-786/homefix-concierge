# Live provider matching

Use the live Composio Taskrabbit capabilities for every provider lookup. The server adapter owns the discovered tool names, schema validation, argument mapping, and allowlist.

1. Check `get_taskrabbit_status` when capability availability is unknown or the dashboard indicates an integration problem.
2. Call `list_supported_services` for the user's location when the required category is not established.
3. Call `find_service_options` for each required category and include only fields actually returned by the provider.
4. If the provider returns scoping questions, ask them plainly and use the answers only where the discovered schema supports them.
5. Use `compare_service_options` for deterministic fit and budget comparison. Do not rank or total options using model guesses.

Every option must show:

- service category and coverage/location;
- price, range, estimate, or an explicit “price not provided” state;
- returned availability details or an explicit unknown state;
- `live_taskrabbit` source and retrieval time;
- any limitation that affects the recommendation.

Do not claim that one provider covers multiple repairs unless the live response supports that claim. A result at or beyond 15 minutes is stale for handoff; refresh it before creating a link. If the integration fails or returns no options, show that truthfully and offer a retry or narrower request.
