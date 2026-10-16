# Phase 0 evidence — repository baseline and delivery setup

Status: complete for the local baseline gate.

## Inventory

- Package manager: npm, with `package-lock.json` committed.
- Runtime: Node.js `>=22.22.2` from `package.json`; local protocol run used Node.js `24.21.0`.
- Server framework: `mcp-use` `2.10.0`.
- Bundled official MCP packages: `@modelcontextprotocol/client`, `@modelcontextprotocol/core`, and `@modelcontextprotocol/server`, each `2.3.1` through the installed `mcp-use` dependency tree.
- UI: React `19.2.7` and `mcp-use/react` MCP App View runtime.
- Validation: Zod `4.4.3`.
- Entry point: `index.ts`, default-exporting one `MCPServer` instance.
- View convention: `views/<name>/view.tsx` with colocated CSS; the active spike is `views/compatibility-view/`.
- Generated View registry: `mcp-env.d.ts`, refreshed by `npm run typecheck`.
- Build output: `.mcp-use/build/`, ignored by Git.

## Starter scaffolding disposition

The original `show-app`, `say-hello`, `views/my-view/`, counter state, starter mesh, starter tooltip, and mcp-use branding were generic scaffolding. They were removed from the active project surface. The temporary `compatibility-probe` and `compatibility-view` are clearly labeled as Phase 1 infrastructure work and contain no product data.

## Conventions established

- Server configuration and environment parsing live in `src/config/`.
- OAuth consent rendering lives in `src/oauth/`.
- Database migrations will live in `supabase/migrations/` beginning in Phase 2.
- Domain services will live in `src/domain/`; external adapters will live in `src/integrations/`.
- Tests and protocol checks will live in `scripts/` and `tests/`, with test doubles isolated from runtime modules.
- One Manufact deployment owns the MCP endpoint and Views. No standalone SPA, REST API, or duplicate chat agent is introduced.

## Environment names

The names are documented in [`.env.example`](../../.env.example):

`NODE_ENV`, `MCP_ENDPOINT_PATH`, `MCP_URL`, `LOG_LEVEL`, `COMPOSIO_API_KEY`, `TASKRABBIT_TOOL_MAP_JSON`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MCP_USE_OAUTH_SUPABASE_PROJECT_ID`, `MCP_USE_OAUTH_SUPABASE_JWT_SECRET`, `RATE_LIMIT_PER_MINUTE`, and `OUTBOUND_TIMEOUT_MS`.

No secret values are committed.

## Confirmed gaps at the end of Phase 0

- No Supabase project configuration or user data is present.
- No Composio Taskrabbit adapter is present; it is deferred to Phase 4.
- No database migrations or domain persistence modules are present; they are deferred to Phase 2.
- Live Manufact Cloud Chat, local Inspector View rendering, and Supabase OAuth approval require external project/deployment access.

## P0 checklist mapping

| P0 area | Phase 0 result |
| --- | --- |
| Authenticated household isolation | Deferred to Phase 2; module boundary and env names are established. |
| Domain state and persistence | Deferred to Phase 2/3; migration location is established. |
| Live Taskrabbit data | Deferred to Phase 4; no fixtures or fake provider mode added. |
| MCP endpoint and View | Phase 1 compatibility surface implements the first verifiable slice. |
| Failure truthfulness | Readiness reports missing dependencies as degraded; no fallback data exists. |
| Deployment | One `mcp-use` server plus View remains the deployment shape. |

## Baseline checks

- `npm run typecheck`: passed.
- `npm run build`: passed; output contained `compatibility-view`.

