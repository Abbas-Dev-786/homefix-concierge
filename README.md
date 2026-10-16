# HomeFix Concierge

HomeFix Concierge is being built as one Manufact MCP App deployment: a TypeScript `mcp-use` server with React MCP App Views. The repository is currently at the Phase 1 compatibility spike. It proves the MCP transport, the schema-backed View contract, and the Supabase OAuth integration shape before HomeFix domain workflows are added.

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
```

`npm run dev` serves the MCP endpoint at `http://localhost:3000/mcp` and the local Inspector at `http://localhost:3000/mcp/inspector`. The protocol command starts the production build, connects with the official MCP Streamable HTTP client, verifies the negotiated protocol version, lists tools, and calls the schema-backed compatibility probe.

The active temporary tool is `compatibility-probe`, bound to `views/compatibility-view/`. It is deliberately labeled as a spike and contains no household, provider, booking, or seeded user data.

## Environment variables

See [.env.example](.env.example) for names and safe placeholders. The Phase 1 OAuth provider reads `SUPABASE_URL`; the consent page also needs `SUPABASE_ANON_KEY`. Supabase OAuth 2.1, dynamic client registration, asymmetric JWT signing, Site URL, and the `/oauth/consent` authorization path must be configured in the Supabase project before a live OAuth check can pass. Composio is not used until the later Taskrabbit integration phase.

## Deployment

The same server and View are deployed together through Manufact Cloud:

```bash
npm run deploy
```

Deployment and live host evidence are recorded in [`plan/evidence/phase-01-compatibility-spike.md`](plan/evidence/phase-01-compatibility-spike.md).

