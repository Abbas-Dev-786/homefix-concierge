# Coding Harness Instructions — HomeFix Concierge

Read `PRD.md` and `TECHNICAL_SPEC.md` in full before writing application code. Treat them as the source of truth for scope and acceptance criteria.

## Mission

Implement a polished, reliable HomeFix Concierge MCP App for the Amazon Developer Hackathon Alexa+ track. Build a real HomeFix MCP server and use its React MCP App View as the primary UI rendered by the connected MCP host. Do not build a separate standalone React/Vite simulator for the MVP. Integrate Taskrabbit through Composio MCP, store durable state in Supabase Postgres, and deploy the MCP App to Manufact Cloud. Do not use AWS services.

## Architecture decisions you must preserve

- UI: React + TypeScript MCP App View in `views/<name>/view.tsx`, built and served with the HomeFix MCP server by Manufact `mcp-use`.
- Backend/API: HomeFix MCP tools and server-side domain services in Node.js + TypeScript. MCP tools are the product's callable API; do not add a separate `/api/*` application service for the MVP.
- Hosting: Manufact Cloud for the HomeFix MCP server and its Views.
- Reference host: Manufact Cloud Chat for deployed walkthroughs and the mcp-use Inspector locally. Verify MCP View rendering, Supabase OAuth, tool calls, and external-link behavior in these hosts. Alexa+ native-device/add-on UI integration is out of P0 scope; the track requirement is demonstrated by the deployed self-hosted MCP endpoint.
- MCP server: Manufact `mcp-use`, after an actual protocol test proves MCP `2025-11-25` or later over Streamable HTTP. If not, use the official MCP TypeScript SDK for the server layer while retaining Manufact hosting if compatible.
- Integrations: Composio Taskrabbit MCP. Discover actual capabilities and schemas; do not guess tool IDs/argument shapes.
- Database: Supabase Postgres; server-side credentials only.
- Agent: the connected MCP host supplies the conversational model and invokes HomeFix tools; do not add scripted behavior or a duplicate server-side chat agent.
- No AWS, no direct payment handling, no fabricated booking confirmation.
- The product UI is the Manufact-hosted HomeFix MCP App View. The existing `views/my-view` plus `show-app`/`say-hello` and counter are generic starter examples; replace them with actual HomeFix tools and View behavior. Do not ship starter examples as product functionality.
- The MCP server, its server-side API/domain logic, and React Views are one deployed MCP App. Supabase and Composio are external integrations. The connected MCP host invokes HomeFix tools through the real MCP protocol.

## Implement in this order

1. Inspect repository; preserve working code.
2. Replace starter tools and the View with HomeFix MCP tools, Supabase OAuth 2.1 via mcp-use's Supabase provider, the same-deployment `/oauth/consent` page, one-household-per-user onboarding/profile tools, and health/readiness behavior.
3. Build minimum `/mcp` server and protocol compliance test. Do not proceed until protocol negotiation passes.
4. Create database migrations, authenticated household repositories, typed domain models, and state machine. Do not seed fictional household or repair records.
5. Implement the Composio Taskrabbit MCP adapter by inspecting the actual remote tool list and schemas. No demo adapter or fixture results in product runtime.
6. Require live Composio for service discovery, availability, pricing, and booking-link generation; show actionable errors if unavailable.
7. Expose HomeFix tools for state, live Taskrabbit lookup, handoff, and outcomes. The MCP host calls the server through the real protocol. Do not fake tool traces.
8. Build the React MCP App View with real tool results, actual event/status views, pending/error/empty states, and explicit user-approved external handoff.
9. Add tests for live integration errors, authenticated persistence, booking handoff, invalid transitions, and URL validation. Test doubles remain isolated to tests and are never exposed to users.
10. Deploy to Manufact Cloud and test the public HTTPS MCP endpoint and View; complete README, `.env.example`, and live walkthrough instructions.

## Required product behavior

- Two repair requests can be tracked independently.
- Split multiple repairs from one utterance into independent requests linked by an intake group. A stated total budget belongs to the group; compute fit only when all selected options have comparable numeric upper estimates in one currency. Otherwise report the total/fit as unknown.
- HomeFix persists home/repair context across reload/new session.
- All service data comes from actual Composio Taskrabbit MCP calls. There is no demo provider mode.
- Missing credentials, outages, and unsupported capabilities return errors; never replace them with fixtures or simulated results.
- No results, missing prices, and missing availability are represented as unknown, not fabricated.
- A booking deep link is an external handoff; link opening never marks the task as booked.
- User-reported outcomes are explicitly sourced as user-reported.
- Use the PRD's canonical maintenance and handoff status lists and outcome mappings; never mix their distinct vocabularies.
- A unique, unambiguous existing repair may be updated on return. Ask the user to identify the repair if multiple records could match; do not choose the most recent by default.
- Users authenticate with Supabase Auth OAuth 2.1; household scope comes from verified `ctx.auth.user.id` and membership. P0 creates one household per user.
- Taskrabbit results expire for handoff after exactly 15 minutes; re-run a live lookup before preparing a handoff from an older result.
- Supabase, the authenticated MCP host connection, and Composio Taskrabbit MCP are required for product readiness. If one is unavailable, show an error and do not claim the workflow completed.
- Selecting an option prepares a live link but never navigates. “Continue to Taskrabbit” is the explicit user action that opens the validated Taskrabbit link.
- Follow-through updates existing records instead of creating duplicates.
- Do not use fabricated records, fake provider data, scripted agent responses, or simulated handoffs in the walkthrough.

## Done means

Every P0 acceptance criterion in the PRD passes. The MCP protocol test passes against the actual server; typecheck/lint/tests/build pass; the MCP App View works with authenticated users and live Composio calls; live failures are handled visibly without substitution; no secret is in View assets; and deployment/setup instructions reflect the actual repository. Do not stop after creating an attractive UI or stubbed endpoints.

## Before declaring completion, report

1. Implemented features and remaining gaps.
2. Exact MCP SDK/package versions and protocol test outcome.
3. Which Taskrabbit MCP capabilities were discovered and how they mapped to HomeFix features.
4. Which Taskrabbit capabilities were verified live and what happens when a capability is unavailable.
5. Tests executed and their results.
6. Required environment variables and local run commands.
7. Deployment steps and any unverified assumptions.
