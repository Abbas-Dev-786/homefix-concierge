# HomeFix Concierge

HomeFix Concierge is being built as one Manufact MCP App deployment: a TypeScript `mcp-use` server with React MCP App Views. Phase 1 compatibility is complete, including deployed MCP transport, schema-backed View behavior, Supabase OAuth, and manual host verification. HomeFix domain workflows begin in Phase 2.

## Local setup

Requirements:

- Node.js `>=22.22.2`
- npm

Install dependencies and copy the environment template:

```bash
npm install
copy .env.example .env
```

The local compatibility surface runs without credentials. Supabase OAuth and Composio are reported as unavailable until their server-only variables are configured. Never put service-role keys or access tokens in View code.

## Commands

```bash
npm run dev
npm run typecheck
npm run build
npm run verify:protocol
npm run test:unit
npm run verify:deployed
npm run verify:phase2-3
```

`npm run dev` serves the MCP endpoint at `http://localhost:3000/mcp` and the local Inspector at `http://localhost:3000/mcp/inspector`. The protocol command starts the production build, connects with the official MCP Streamable HTTP client, verifies the negotiated protocol version, lists tools, and calls the schema-backed compatibility probe.

The active compatibility tool is `compatibility-probe`, bound to `views/compatibility-view/`. Authenticated HomeFix tools are registered alongside it when Supabase OAuth is configured. They use only the authenticated household and live Composio Taskrabbit responses; no provider fixtures are bundled.

Phase 2 and Phase 3 add authenticated household/profile persistence and typed HomeFix domain tools. Apply the checked-in migrations to the intended Supabase project before using those tools with real data:

```bash
supabase db push
```

The migrations are not applied automatically. The deployment must have `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY`; the service key is never sent to Views or MCP tool output.

For a real Phase 2/3 exit check, create two dedicated Supabase test users, obtain temporary access tokens for both, set `PHASE23_TEST_ACCESS_TOKEN_A` and `PHASE23_TEST_ACCESS_TOKEN_B` only in the local shell, and run `npm run verify:phase2-3` against the deployed `MCP_URL`. The verifier creates one isolated test household and repair record for user A and confirms user B cannot read or mutate it. Remove both token variables after the check.

Phase 4/5 requires the server-only Composio project API key (`COMPOSIO_API_KEY`, normally `ak_...`) and a Taskrabbit connection in Composio. The key must have **Session management: write** and **Session tool execution** permissions; read-only session management keys return HTTP 403 when a per-user session is created. A `ck_...` consumer key belongs to Composio Connect and cannot authenticate this server integration. `TASKRABBIT_TOOL_MAP_JSON` is optional when live tool descriptions identify exactly one tool per capability; otherwise set it to the exact discovered names for `listServices`, `checkAvailability`, and `createDeepLink`. The adapter uses Composio's official TypeScript session SDK, creates a per-user session from the verified Supabase user ID, and never opens a booking link or claims a booking.

When a temporary Supabase access token is available, the protocol check can also verify the protected identity tool. Set it only in the current shell and never commit it:

```powershell
$env:PHASE1_TEST_ACCESS_TOKEN = "<temporary access token>"
npm run verify:protocol
Remove-Item Env:PHASE1_TEST_ACCESS_TOKEN
```

## Environment variables

See [.env.example](.env.example) for names and safe placeholders. The Phase 1 OAuth provider reads `SUPABASE_URL`; the consent page also needs `SUPABASE_ANON_KEY`. Supabase OAuth 2.1, dynamic client registration, asymmetric JWT signing, Site URL, and the `/oauth/consent` authorization path must be configured in the Supabase project before a live OAuth check can pass. Phase 4/5 also uses `COMPOSIO_API_KEY`, optional `COMPOSIO_API_BASE_URL`, and optional `TASKRABBIT_TOOL_MAP_JSON` on the server only.

## Deployment

The same server and View are deployed together through Manufact Cloud:

```bash
npm run deploy
```

For the deployed environment, set `MCP_URL` to the public HTTPS `/mcp` URL and run `npm run verify:deployed`. Deployment and live host evidence are recorded in [`plan/evidence/phase-01-compatibility-spike.md`](plan/evidence/phase-01-compatibility-spike.md).

