import { MCPServer } from "mcp-use";
import { oauthSupabaseProvider, type SupabaseOAuthUser } from "mcp-use/oauth/supabase";
import { z } from "zod";

import {
  composioConfigured,
  env,
  oauthConfigured,
  supabaseConfigured,
} from "./src/config/env.js";
import { consentPageError, renderConsentPage } from "./src/oauth/consent-page.js";

const compatibilityInputSchema = z.object({
  label: z
    .string()
    .trim()
    .max(80)
    .optional()
    .describe("Optional label used to identify this compatibility check"),
});

const compatibilityOutputSchema = z.object({
  phase: z.literal("phase-1-compatibility-spike"),
  label: z.string(),
  transport: z.literal("streamable-http"),
  protocolVersion: z.literal("2025-11-25"),
  viewBinding: z.literal("compatibility-view"),
  clientSupportsViews: z.boolean(),
  oauth: z.enum(["configured", "not-configured"]),
});

const serverConfig = {
  name: "homefix-concierge",
  title: "HomeFix Concierge",
  version: "0.1.0-phase-1",
  description: "HomeFix Concierge compatibility spike for MCP, Views, and OAuth.",
  instructions:
    "This endpoint is in the Phase 1 compatibility spike. Use compatibility-probe to verify MCP transport, View binding, and host capabilities.",
  websiteUrl: "https://mcp-use.com",
  basePath: env.MCP_ENDPOINT_PATH,
  icons: [{ src: "icon.svg", mimeType: "image/svg+xml", sizes: ["512x512"] }],
};

const oauthResource =
  env.MCP_URL ??
  (env.NODE_ENV === "development"
    ? `http://localhost:3000${env.MCP_ENDPOINT_PATH}`
    : undefined);

const server = oauthConfigured
  ? new MCPServer<SupabaseOAuthUser>({
      ...serverConfig,
      oauth: oauthSupabaseProvider({
        ...(env.SUPABASE_URL ? { supabaseUrl: env.SUPABASE_URL } : {}),
        ...(env.MCP_USE_OAUTH_SUPABASE_PROJECT_ID
          ? { projectId: env.MCP_USE_OAUTH_SUPABASE_PROJECT_ID }
          : {}),
        ...(oauthResource ? { resource: oauthResource } : {}),
        resourceName: "HomeFix Concierge",
        scopesSupported: ["openid", "email", "profile"],
      }),
      mixedAuth: true,
    })
  : new MCPServer({ ...serverConfig });

const typedServer = server as MCPServer<SupabaseOAuthUser>;

export const compatibilityProbe = typedServer.tool(
  {
    name: "compatibility-probe",
    title: "Run compatibility probe",
    description:
      "Verify the local MCP transport and the host's MCP App View bridge during the Phase 1 spike.",
    inputSchema: compatibilityInputSchema,
    outputSchema: compatibilityOutputSchema,
    securitySchemes: oauthConfigured ? [{ type: "noauth" as const }] : undefined,
    view: {
      name: "compatibility-view",
      description: "Phase 1 compatibility results for transport, View binding, and host actions.",
      prefersBorder: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ label }, ctx) => {
    const data = {
      phase: "phase-1-compatibility-spike" as const,
      label: label?.trim() || "manual check",
      transport: "streamable-http" as const,
      protocolVersion: "2025-11-25" as const,
      viewBinding: "compatibility-view" as const,
      clientSupportsViews: ctx.client.supportsViews(),
      oauth: oauthConfigured ? ("configured" as const) : ("not-configured" as const),
    };

    return {
      content: [{ type: "text" as const, text: `Compatibility probe completed for ${data.label}.` }],
      structuredContent: data,
    };
  }
);

export const verifyIdentity = oauthConfigured
  ? typedServer.tool(
      {
        name: "verify-identity",
        title: "Verify authenticated identity",
        description:
          "Return the verified Supabase user ID from the OAuth request context without accepting a caller-supplied identity.",
        inputSchema: z.object({}),
        outputSchema: z.object({ userId: z.string(), source: z.literal("verified-oauth") }),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (_, ctx) => ({
        content: [{ type: "text" as const, text: "Authenticated identity verified by Supabase OAuth." }],
        structuredContent: {
          userId: ctx.auth.user.id,
          source: "verified-oauth" as const,
        },
      })
    )
  : undefined;

server.get("/health", (c) =>
  c.json({ status: "ok", service: "homefix-concierge" })
);

server.get("/ready", (c) => {
  const authStatus = oauthConfigured ? "configured" : "not-configured";
  const status = oauthConfigured && supabaseConfigured && composioConfigured ? "ready" : "degraded";
  return c.json(
    {
      status,
      checks: {
        mcp: "configured",
        oauth: authStatus,
        supabase: supabaseConfigured ? "configured" : "not-configured",
        composio: composioConfigured ? "configured" : "not-configured",
      },
    },
    status === "ready" ? 200 : 503
  );
});

server.get("/oauth/consent", (c) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return c.html(
      consentPageError(
        "Supabase OAuth consent is unavailable because SUPABASE_URL or SUPABASE_ANON_KEY is not configured."
      ),
      503
    );
  }

  return c.html(
    renderConsentPage({
      supabaseUrl: env.SUPABASE_URL,
      supabaseAnonKey: env.SUPABASE_ANON_KEY,
    })
  );
});

export default server;

