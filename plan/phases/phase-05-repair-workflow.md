# Phase 5 — End-to-end repair workflow and orchestration

## Goal

Make the connected MCP host's model able to coordinate the full product workflow through HomeFix tools while server-side code enforces all business and safety rules.

## Dependencies

- Phase 3 domain tools and persistence pass.
- Phase 4 real Taskrabbit adapter is available.
- A compatible host can authenticate and call the server tools.

## Work

1. Configure server instructions and concise tool descriptions so a connected host can discover what to call, when to clarify, and which tool result is authoritative.
2. Keep conversation/model orchestration in the connected MCP host. Do not create a HomeFix chat endpoint, scripted intent parser, server-owned LLM, or duplicate agent.
3. Implement and walk through the real user path: authenticate; explicitly create/save household profile; create one or more repair records/groups; retrieve context; clarify missing required provider inputs; discover services; get live options; compare; select; prepare a link; ask for a user click; record opened; later retrieve the same repairs and record user-reported outcomes.
4. Apply minimum disclosure when making provider queries: send only required service/location/scoping information, not unrelated profile or conversation data.
5. Split multi-repair requests into independent repair records linked to one intake group. Apply group budget logic only to numeric upper estimates in a common currency; otherwise return unknown.
6. Make follow-up updates deterministic: update a unique matching repair; if multiple repairs could match, request clarification before mutation.
7. Make every operation reflect real state, including pending, unavailable, provider error, empty results, ready handoff, user-opened link, and user-reported outcomes.
8. Keep tool traces/activity derived from actual HomeFix/Composio calls and sanitized events; never synthesize a tool trace for the demo.
9. Verify host-visible tool discovery and call sequences in Manufact Cloud Chat and Inspector. Record any host limitations in the UI plan.

## Deliverables

- Host-facing MCP instructions/tool descriptions.
- A verified end-to-end server workflow with persisted state and live provider calls.
- Scenario walkthrough notes for happy path, missing details, zero results, provider outage, no estimate, multi-repair, ambiguous follow-up, and handoff retry.

## Exit gate

- The host can complete the journey without a separate API or HomeFix agent runtime.
- All provider-derived claims are directly supported by current live responses and are timestamped.
- No external URL opens until the user activates the View control.
- Handoff opening never marks a repair booked; later outcomes remain explicitly user-reported.
- Failures or missing data leave workflow state accurate and recoverable, with no fabricated success.

## Do not do in this phase

- Do not auto-select the newest repair when the user's reference is ambiguous.
- Do not treat a chat transcript or session ID as durable identity/state.
- Do not open external links as a side effect of model/tool selection.

