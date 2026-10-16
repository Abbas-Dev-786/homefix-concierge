# Phase 1 — MCP, View-host, and OAuth compatibility spike

## Goal

Prove the platform path before building the product on it: Streamable HTTP, MCP `2025-11-25` or later, View rendering in the selected hosts, and Supabase OAuth compatibility.

## Dependencies

- Phase 0 repository inventory.
- Test Manufact deployment/workspace and Supabase project access when running live checks.
- No production user data or live booking flow is needed.

## Work

1. Verify the installed mcp-use version and APIs against its installed declarations and current official docs.
2. Build the smallest temporary or spike server endpoint that can be driven through a real MCP client using Streamable HTTP.
3. Negotiate protocol version `2025-11-25`; assert the actual response and initialized lifecycle rather than checking a package version string.
4. Render a minimal schema-backed MCP View through the local Inspector and Manufact Cloud Chat. Verify pending, result, and error rendering, a View-to-tool call, and a user-click host action where supported.
5. Verify the Supabase Auth OAuth 2.1 / Dynamic Client Registration flow with the mcp-use Supabase provider, including token verification and normalized `ctx.auth.user.id`.
6. Verify the consent page can be served at `/oauth/consent` on the same Manufact deployment and check Supabase Site URL/redirect requirements.
7. Record which host capabilities are available (external link opening, View rendering, auth prompts, tool calls). Define a fallback only for a verified unsupported capability.
8. If mcp-use fails protocol conformance, evaluate the official MCP TypeScript SDK server layer while retaining Manufact deployment. Do not bypass the gate.

## Deliverables

- Protocol test and recorded negotiated version/transport outcome.
- Host compatibility notes for local Inspector and deployed Manufact Cloud Chat.
- Confirmed OAuth provider configuration, consent-route behavior, and redirect configuration.
- A written decision if the protocol server layer must change; keep the rest of the Manufact architecture intact where compatible.

## Exit gate

- Real client connects through Streamable HTTP and proves MCP `2025-11-25` or later.
- The selected host renders an MCP View bound to a tool with matching `outputSchema` and `structuredContent`.
- Authenticated calls expose verified identity in request context; unauthenticated access is rejected for protected data tools.
- The consent and redirect flow is demonstrated or the incompatibility and a concrete compliant path are documented before proceeding.
- External-link behavior is user initiated and its host limitation is known.

## Completion note

Local protocol and build evidence is recorded in [`../evidence/phase-01-compatibility-spike.md`](../evidence/phase-01-compatibility-spike.md). The live Supabase and Manufact host portions remain explicitly pending because this workspace has no project credentials or deployed endpoint.

## Do not do in this phase

- Do not build HomeFix business features on an unverified transport/auth foundation.
- Do not infer host support based on marketing pages alone.
- Do not put test credentials, access tokens, or service secrets in source control or View assets.

