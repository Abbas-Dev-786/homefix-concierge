# Phase 1 evidence — MCP, View host, and OAuth compatibility spike

Status: local protocol and implementation gates passed. Live Supabase and Manufact host gates remain pending external configuration.

## Protocol result

`npm run verify:protocol` starts the built server, connects through the official `StreamableHTTPClientTransport`, performs the MCP initialize lifecycle, calls `tools/list`, and calls `compatibility-probe`.

Recorded result:

```json
{
  "status": "passed",
  "transport": "streamable-http",
  "negotiatedProtocolVersion": "2025-11-25",
  "requiredProtocolVersion": "2025-11-25",
  "toolCount": 1,
  "viewResource": "ui://views/compatibility-view.html",
  "readiness": { "status": 503, "body": { "status": "degraded" } },
  "consent": { "status": 503 },
  "probeStructuredContent": {
    "phase": "phase-1-compatibility-spike",
    "transport": "streamable-http",
    "protocolVersion": "2025-11-25",
    "viewBinding": "compatibility-view"
  }
}
```

The negotiated value is read from the live client transport after initialization. It is not inferred from the package version. The installed SDK exports `LATEST_PROTOCOL_VERSION = "2025-11-25"` and `mcp-use` 2.10.0 successfully serves that protocol over `/mcp`.

## View contract

- `compatibility-probe` declares an `outputSchema` and returns matching `structuredContent`.
- The tool binds to `views/compatibility-view/`.
- The View has pending, error, and ready states.
- The “Call tool from View” control invokes the same exported server tool over the MCP App bridge.
- The “Open MCP docs” control uses `useOpenExternal` and is disabled when the host does not advertise `openLinks`.
- The build completed with the View registry containing only `compatibility-view`.

The official protocol client used by the local script does not advertise the MCP Apps UI extension, so its compatibility result correctly reports `clientSupportsViews: false`. That client proves the server-side protocol and tool contract; it is not evidence that the Inspector or Manufact Cloud Chat rendered the View.

The installed screenshot command also requires the optional `@mcp-use/client` peer, which is absent from the starter. An install attempt could not complete in this workspace and did not change `package.json` or `package-lock.json`. The View was therefore verified by typecheck/build contracts and the emitted `ui://views/compatibility-view.html` binding, while host rendering remains pending.

## OAuth implementation decision

Keep `mcp-use` as the protocol server. The installed `oauthSupabaseProvider` declaration and implementation provide the required resource-server shape:

- `supabaseUrl` or `projectId` configuration;
- Supabase OAuth metadata for authorization, token, and dynamic registration endpoints;
- ES256 JWKS verification by default, with legacy HS256 only when an explicit JWT secret is provided;
- normalized `ctx.auth.user.id` from verified Supabase `sub` or `user_id` claims.

When Supabase configuration is present, the server enables `oauthSupabaseProvider`, `mixedAuth`, and the protected `verify-identity` tool. The tool accepts no caller-supplied identity. Without configuration, local protocol development remains available and the protected tool is not registered.

## Consent route

`GET /oauth/consent` is served by the same `mcp-use` deployment. The page uses the Supabase browser client to:

1. read `authorization_id`;
2. load authorization details;
3. display the requesting client and scopes;
4. call `approveAuthorization` or `denyAuthorization`; and
5. redirect to Supabase’s returned `redirect_url`.

With no Supabase variables it returns an explicit HTTP 503 configuration error. This avoids presenting an incomplete consent flow as working.

## Host and live OAuth checks

Not run in this workspace because no Supabase project credentials or Manufact deployment URL are configured:

- Supabase OAuth 2.1 authorization and dynamic client registration;
- asymmetric token verification with a real Supabase access token;
- Inspector View rendering and View-to-tool call in a host that advertises MCP Apps;
- Manufact Cloud Chat View rendering;
- user initiated external-link behavior in the selected deployed host;
- Site URL, redirect allowlist, and `/oauth/consent` round trip.

These are the remaining Phase 1 exit-gate checks. The implementation is ready for them without changing the server architecture.

