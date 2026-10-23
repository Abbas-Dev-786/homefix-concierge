import { MCPServer } from "mcp-use";
import { oauthSupabaseProvider, type SupabaseOAuthUser } from "mcp-use/oauth/supabase";
import { z } from "zod";

import {
  composioConfigured,
  env,
  oauthConfigured,
  persistenceConfigured,
  supabaseConfigured,
} from "./src/config/env.js";
import { SupabaseRestClient } from "./src/integrations/supabase-rest.js";
import { ComposioTaskrabbitAdapter } from "./src/integrations/composio-taskrabbit.js";
import { consentPageError, renderConsentPage } from "./src/oauth/consent-page.js";
import { HomeFixRepository } from "./src/repositories/homefix-repository.js";
import { registerHomeFixTools } from "./src/tools/homefix-tools.js";
import { clientAddress, MAX_REQUEST_BYTES, SlidingWindowRateLimiter } from "./src/security/request-limits.js";

const serverConfig = {
  name: "homefix-concierge",
  title: "HomeFix Concierge",
  version: "0.1.0",
  description: "HomeFix Concierge for household repair intake, live provider discovery, and user-approved booking handoffs.",
  instructions:
    "Coordinate HomeFix repair requests using the authenticated household context. Before calling find_service_options, confirm a service category, location, desired date, and desired time window; if any are missing, ask the user first and do not call the provider. Use live Taskrabbit results only when returned by the integration, show timestamps, ask for explicit user selection, and never claim a repair is booked unless the user reports that outcome.",
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

const requestLimiter = new SlidingWindowRateLimiter(env.RATE_LIMIT_PER_MINUTE);
server.use(async (c, next) => {
  if (c.req.path !== env.MCP_ENDPOINT_PATH) return next();
  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > Math.min(env.MAX_REQUEST_BYTES, MAX_REQUEST_BYTES)) {
    return c.json({ error: "Request body is too large." }, 413);
  }
  if (!requestLimiter.allow(`mcp:${clientAddress(c.req.raw.headers)}`)) {
    return c.json({ error: "Too many requests. Please retry shortly." }, 429, { "Retry-After": "60" });
  }
  await next();
});

const typedServer = server as MCPServer<SupabaseOAuthUser>;

const homefixRepository = persistenceConfigured
  ? new HomeFixRepository(new SupabaseRestClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, env.OUTBOUND_TIMEOUT_MS))
  : undefined;

const taskrabbitAdapter = composioConfigured
  ? new ComposioTaskrabbitAdapter({
    apiKey: env.COMPOSIO_API_KEY,
    baseUrl: env.COMPOSIO_API_BASE_URL,
    toolMapJson: env.TASKRABBIT_TOOL_MAP_JSON,
    timeoutMs: env.OUTBOUND_TIMEOUT_MS,
  })
  : undefined;

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

const registeredHomeFixTools = oauthConfigured
  ? registerHomeFixTools(typedServer, homefixRepository, taskrabbitAdapter)
  : undefined;

type HomeFixToolRefs = NonNullable<typeof registeredHomeFixTools>;

export const createHousehold = registeredHomeFixTools?.createHousehold as HomeFixToolRefs["createHousehold"];
export const saveHomeProfile = registeredHomeFixTools?.saveHomeProfile as HomeFixToolRefs["saveHomeProfile"];
export const openHomefixDashboard = registeredHomeFixTools?.openHomefixDashboard as HomeFixToolRefs["openHomefixDashboard"];
export const getHomeContext = registeredHomeFixTools?.getHomeContext as HomeFixToolRefs["getHomeContext"];
export const listMaintenanceRequests = registeredHomeFixTools?.listMaintenanceRequests as HomeFixToolRefs["listMaintenanceRequests"];
export const createRepairGroup = registeredHomeFixTools?.createRepairGroup as HomeFixToolRefs["createRepairGroup"];
export const createRepairRequest = registeredHomeFixTools?.createRepairRequest as HomeFixToolRefs["createRepairRequest"];
export const updateMaintenanceStatus = registeredHomeFixTools?.updateMaintenanceStatus as HomeFixToolRefs["updateMaintenanceStatus"];
export const listSupportedServices = registeredHomeFixTools?.listSupportedServices as HomeFixToolRefs["listSupportedServices"];
export const findServiceOptions = registeredHomeFixTools?.findServiceOptions as HomeFixToolRefs["findServiceOptions"];
export const createBookingHandoff = registeredHomeFixTools?.createBookingHandoff as HomeFixToolRefs["createBookingHandoff"];
export const getTaskrabbitStatus = registeredHomeFixTools?.getTaskrabbitStatus as HomeFixToolRefs["getTaskrabbitStatus"];
export const compareServiceOptions = registeredHomeFixTools?.compareServiceOptions as HomeFixToolRefs["compareServiceOptions"];
export const evaluateRepairGroupBudget = registeredHomeFixTools?.evaluateRepairGroupBudget as HomeFixToolRefs["evaluateRepairGroupBudget"];
export const recordHandoffOpened = registeredHomeFixTools?.recordHandoffOpened as HomeFixToolRefs["recordHandoffOpened"];
export const getActivity = registeredHomeFixTools?.getActivity as HomeFixToolRefs["getActivity"];
export const recordBookingOutcome = registeredHomeFixTools?.recordBookingOutcome as HomeFixToolRefs["recordBookingOutcome"];
export const exportHouseholdData = registeredHomeFixTools?.exportHouseholdData as HomeFixToolRefs["exportHouseholdData"];
export const deleteHouseholdData = registeredHomeFixTools?.deleteHouseholdData as HomeFixToolRefs["deleteHouseholdData"];

server.get("/health", (c) =>
  c.json({ status: "ok", service: "homefix-concierge" })
);

server.get("/ready", (c) => {
  const authStatus = oauthConfigured ? "configured" : "not-configured";
  const status = oauthConfigured && supabaseConfigured && persistenceConfigured && composioConfigured ? "ready" : "degraded";
  return c.json(
    {
      status,
      checks: {
        mcp: "configured",
        oauth: authStatus,
        supabase: supabaseConfigured ? "configured" : "not-configured",
        persistence: persistenceConfigured ? "configured" : "not-configured",
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

