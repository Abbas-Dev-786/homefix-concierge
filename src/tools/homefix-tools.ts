import { z } from "zod";
import type { MCPServer } from "mcp-use";
import type { SupabaseOAuthUser } from "mcp-use/oauth/supabase";

import { assertMaintenanceTransition, maintenanceStatuses } from "../domain/maintenance-state.js";
import { HomeFixError, errorResult } from "../domain/errors.js";
import { HomeFixRepository } from "../repositories/homefix-repository.js";

const oauthSecurity = [{ type: "oauth2" as const, scopes: ["openid", "email", "profile"] }];

const sourceSchema = z.literal("supabase");
const profileSchema = z.object({
  id: z.string(),
  propertyType: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  countryCode: z.string().nullable(),
  currencyCode: z.string().nullable(),
  preferredServiceWindows: z.array(z.unknown()),
  typicalBudgetAmount: z.number().nullable(),
  homeSummary: z.string().nullable(),
  source: sourceSchema,
});
const requestSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  room: z.string().nullable(),
  serviceCategory: z.string().nullable(),
  urgency: z.enum(["routine", "soon", "urgent"]),
  status: z.enum(maintenanceStatuses),
  desiredDate: z.string().nullable(),
  desiredTimeWindow: z.string().nullable(),
  budgetMax: z.number().nullable(),
  currencyCode: z.string().nullable(),
  statusSource: z.enum(["system", "user_reported", "provider_verified"]),
  intakeGroupId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  source: sourceSchema,
});

const profileInputSchema = z.object({
  propertyType: z.string().trim().max(80).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(24).optional(),
  countryCode: z.string().trim().length(2).optional(),
  currencyCode: z.string().trim().length(3).optional(),
  preferredServiceWindows: z.array(z.string().trim().max(120)).max(12).optional(),
  typicalBudgetAmount: z.number().finite().min(0).max(1_000_000).optional(),
  homeSummary: z.string().trim().max(1000).refine(
    (value) => !/(password|passcode|access code|door code|alarm code|credit card|cvv|payment|ssn|social security)/i.test(value),
    "Home summary cannot contain credentials, access codes, payment data, or government IDs"
  ).optional(),
}).strict();

const repairInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1500),
  serviceCategory: z.string().trim().max(120).optional(),
  room: z.string().trim().max(120).optional(),
  urgency: z.enum(["routine", "soon", "urgent"]),
  desiredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  desiredTimeWindow: z.string().trim().max(120).optional(),
  budgetMax: z.number().finite().min(0).max(1_000_000).optional(),
  currencyCode: z.string().trim().length(3).optional(),
  intakeGroupId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
}).strict();

const protectedTool = {
  securitySchemes: oauthSecurity,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

function userIdFromContext(ctx: { auth?: { user?: { id?: string } } }) {
  const userId = ctx.auth?.user?.id;
  if (!userId) throw new HomeFixError("AUTH_REQUIRED", "Sign in to use HomeFix household data.", false, "authenticate");
  return userId;
}

function repositoryOrThrow(repository: HomeFixRepository | undefined) {
  if (!repository) {
    throw new HomeFixError(
      "PERSISTENCE_UNAVAILABLE",
      "HomeFix persistence is not configured on this deployment.",
      false,
      "configure_supabase_service_credentials"
    );
  }
  return repository;
}

function withErrors<TArgs, TContext>(handler: (args: TArgs, ctx: TContext) => Promise<any>) {
  return async (args: TArgs, ctx: TContext): Promise<any> => {
    try {
      return await handler(args, ctx);
    } catch (error) {
      return errorResult(error);
    }
  };
}

export function registerHomeFixTools(
  server: MCPServer<SupabaseOAuthUser>,
  repository: HomeFixRepository | undefined
) {
  server.tool({
    ...protectedTool,
    name: "create_household",
    title: "Create my household",
    description: "Explicitly create the signed-in user's one HomeFix household. Repeated calls are safe and return the existing household.",
    inputSchema: z.object({}),
    outputSchema: z.object({ householdId: z.string(), displayName: z.string(), role: z.string(), source: sourceSchema }),
  }, withErrors(async (_, ctx) => {
    const repo = repositoryOrThrow(repository);
    return { content: [{ type: "text", text: "Household onboarding is ready." }], structuredContent: await repo.createHousehold(userIdFromContext(ctx)) };
  }));

  server.tool({
    ...protectedTool,
    name: "save_home_profile",
    title: "Save home profile",
    description: "Create or update the signed-in user's non-sensitive home profile. Access codes, credentials, payment data, and unknown fields are rejected.",
    inputSchema: profileInputSchema,
    outputSchema: profileSchema,
  }, withErrors(async (input, ctx) => {
    const repo = repositoryOrThrow(repository);
    const scope = await repo.resolveHousehold(userIdFromContext(ctx));
    if (!scope) throw new HomeFixError("ONBOARDING_REQUIRED", "Create your household before saving a home profile.", false, "create_household");
    const profile = await repo.saveProfile(scope, input);
    return { content: [{ type: "text", text: "Home profile saved." }], structuredContent: profile };
  }));

  server.tool({
    ...protectedTool,
    name: "open_homefix_dashboard",
    title: "Open HomeFix dashboard",
    description: "Load the signed-in user's household onboarding state, home profile, open maintenance requests, and safe provider capability status.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      onboardingRequired: z.boolean(),
      household: z.object({ id: z.string(), displayName: z.string(), role: z.string() }).nullable(),
      profile: profileSchema.nullable(),
      openRequests: z.array(requestSchema),
      taskrabbit: z.object({ status: z.literal("unavailable"), reason: z.string() }),
      source: sourceSchema,
    }),
  }, withErrors(async (_, ctx) => {
    const dashboard = await repositoryOrThrow(repository).dashboard(userIdFromContext(ctx));
    return {
      content: [{ type: "text", text: dashboard.onboardingRequired ? "HomeFix onboarding is required." : "HomeFix dashboard loaded." }],
      structuredContent: { ...dashboard, taskrabbit: { status: "unavailable" as const, reason: "Live Taskrabbit capability is implemented in Phase 4." } },
    };
  }));

  server.tool({
    ...protectedTool,
    name: "get_home_context",
    title: "Get home context",
    description: "Load the authenticated household's saved home profile and open maintenance requests without accepting a household ID.",
    inputSchema: z.object({ includeOpenTasks: z.boolean().default(true) }),
    outputSchema: z.object({ onboardingRequired: z.boolean(), profile: profileSchema.nullable(), openRequests: z.array(requestSchema), source: sourceSchema }),
  }, withErrors(async ({ includeOpenTasks }, ctx) => {
    const repo = repositoryOrThrow(repository);
    const scope = await repo.resolveHousehold(userIdFromContext(ctx));
    if (!scope) return { content: [{ type: "text", text: "No household has been created yet." }], structuredContent: { onboardingRequired: true, profile: null, openRequests: [], source: "supabase" as const } };
    return { content: [{ type: "text", text: "Home context loaded." }], structuredContent: { onboardingRequired: false, profile: await repo.getProfile(scope), openRequests: includeOpenTasks ? await repo.listRequests(scope, true) : [], source: "supabase" as const } };
  }));

  server.tool({
    ...protectedTool,
    name: "list_maintenance_requests",
    title: "List maintenance requests",
    description: "List persisted maintenance requests belonging only to the signed-in household.",
    inputSchema: z.object({ openOnly: z.boolean().default(false) }),
    outputSchema: z.object({ requests: z.array(requestSchema), source: sourceSchema }),
  }, withErrors(async ({ openOnly }, ctx) => {
    const repo = repositoryOrThrow(repository);
    const scope = await repo.resolveHousehold(userIdFromContext(ctx));
    if (!scope) return { content: [{ type: "text", text: "No household has been created yet." }], structuredContent: { requests: [], source: "supabase" as const } };
    const requests = await repo.listRequests(scope, openOnly);
    return { content: [{ type: "text", text: `${requests.length} maintenance request(s) loaded.` }], structuredContent: { requests, source: "supabase" as const } };
  }));

  server.tool({
    ...protectedTool,
    name: "create_repair_group",
    title: "Create repair group",
    description: "Create a durable group for multiple repair requests or a shared total budget.",
    inputSchema: z.object({ groupBudgetMax: z.number().finite().min(0).max(1_000_000).optional(), currencyCode: z.string().length(3).optional() }).strict(),
    outputSchema: z.object({ id: z.string(), groupBudgetMax: z.number().nullable(), currencyCode: z.string().nullable(), source: sourceSchema }),
  }, withErrors(async ({ groupBudgetMax, currencyCode }, ctx) => {
    const repo = repositoryOrThrow(repository);
    const scope = await repo.resolveHousehold(userIdFromContext(ctx));
    if (!scope) throw new HomeFixError("ONBOARDING_REQUIRED", "Create your household before creating repair groups.", false, "create_household");
    const group = await repo.createRepairGroup(scope, groupBudgetMax, currencyCode);
    return { content: [{ type: "text", text: "Repair group created." }], structuredContent: group };
  }));

  server.tool({
    ...protectedTool,
    name: "create_repair_request",
    title: "Create repair request",
    description: "Create a durable maintenance request for the authenticated household. Repeated idempotent calls return the existing request.",
    inputSchema: repairInputSchema,
    outputSchema: requestSchema,
  }, withErrors(async (input, ctx) => {
    const repo = repositoryOrThrow(repository);
    const scope = await repo.resolveHousehold(userIdFromContext(ctx));
    if (!scope) throw new HomeFixError("ONBOARDING_REQUIRED", "Create your household before recording repairs.", false, "create_household");
    const request = await repo.createRepairRequest(scope, input);
    return { content: [{ type: "text", text: `Repair request ${request.title} is saved.` }], structuredContent: request };
  }));

  server.tool({
    ...protectedTool,
    name: "update_maintenance_status",
    title: "Update maintenance status",
    description: "Move a maintenance request through an allowed server-side state transition using a user-reported note.",
    inputSchema: z.object({ requestId: z.string().uuid(), status: z.enum(maintenanceStatuses), note: z.string().trim().max(500).optional() }).strict(),
    outputSchema: requestSchema,
  }, withErrors(async ({ requestId, status, note }, ctx) => {
    const repo = repositoryOrThrow(repository);
    const scope = await repo.resolveHousehold(userIdFromContext(ctx));
    if (!scope) throw new HomeFixError("ONBOARDING_REQUIRED", "Create your household before updating repairs.", false, "create_household");
    const existing = (await repo.listRequests(scope)).find((request) => request.id === requestId);
    if (!existing) throw new HomeFixError("NOT_FOUND", "That maintenance request was not found in your household.", false, "refresh_dashboard");
    assertMaintenanceTransition(existing.status, status);
    const request = await repo.updateRequestStatus(scope, requestId, status, note);
    return { content: [{ type: "text", text: `Maintenance status is now ${status}.` }], structuredContent: request };
  }));

  const unavailable = (name: string) => server.tool({
    ...protectedTool,
    name,
    title: name.replaceAll("_", " "),
    description: "This provider-backed capability is unavailable until the live Composio Taskrabbit adapter is implemented.",
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.object({ status: z.literal("unavailable"), reason: z.string(), source: z.literal("live_taskrabbit") }),
  }, withErrors(async () => ({
    content: [{ type: "text", text: "Live Taskrabbit capability is unavailable until Phase 4 integration is configured." }],
    structuredContent: { status: "unavailable" as const, reason: "The live Composio Taskrabbit adapter is not implemented yet.", source: "live_taskrabbit" as const },
  })));

  unavailable("list_supported_services");
  unavailable("find_service_options");
  unavailable("create_booking_handoff");

  server.tool({
    ...protectedTool,
    name: "get_taskrabbit_status",
    title: "Get Taskrabbit status",
    description: "Report whether the live Taskrabbit capability is available without exposing credentials or provider payloads.",
    inputSchema: z.object({}),
    outputSchema: z.object({ status: z.literal("unavailable"), reason: z.string(), source: z.literal("live_taskrabbit") }),
  }, withErrors(async () => ({
    content: [{ type: "text", text: "Live Taskrabbit capability is unavailable until Phase 4." }],
    structuredContent: { status: "unavailable" as const, reason: "The live Composio Taskrabbit adapter is not implemented yet.", source: "live_taskrabbit" as const },
  })));

  server.tool({
    ...protectedTool,
    name: "compare_service_options",
    title: "Compare service options",
    description: "Rank persisted live provider options deterministically without inventing missing price or availability data.",
    inputSchema: z.object({ requestId: z.string().uuid(), optionIds: z.array(z.string().uuid()).min(1).max(20) }).strict(),
    outputSchema: z.object({ requestId: z.string(), options: z.array(z.object({ id: z.string(), title: z.string(), estimateMax: z.number().nullable(), currencyCode: z.string().nullable(), reasonCodes: z.array(z.string()), source: z.literal("live_taskrabbit") })), source: z.literal("supabase") }),
  }, withErrors(async ({ requestId, optionIds }, ctx) => {
    const repo = repositoryOrThrow(repository);
    const scope = await repo.resolveHousehold(userIdFromContext(ctx));
    if (!scope) throw new HomeFixError("ONBOARDING_REQUIRED", "Create your household before comparing options.", false, "create_household");
    const options = await repo.listOptions(scope, requestId, optionIds);
    const ranked = options.map((option) => ({
      id: option.id,
      title: option.title,
      estimateMax: option.estimateMax,
      currencyCode: option.currencyCode,
      reasonCodes: [option.estimateMax === null ? "price_unknown" : "price_available", option.availabilitySummary ? "availability_available" : "availability_unknown"],
      source: "live_taskrabbit" as const,
    })).sort((a, b) => (a.estimateMax ?? Number.POSITIVE_INFINITY) - (b.estimateMax ?? Number.POSITIVE_INFINITY));
    return { content: [{ type: "text", text: `${ranked.length} persisted provider option(s) compared.` }], structuredContent: { requestId, options: ranked, source: "supabase" as const } };
  }));

  server.tool({
    ...protectedTool,
    name: "record_handoff_opened",
    title: "Record handoff opened",
    description: "Record that the user initiated an external handoff for a ready option; this never means the repair was booked.",
    inputSchema: z.object({ handoffId: z.string().uuid(), idempotencyKey: z.string().trim().min(8).max(128) }).strict(),
    outputSchema: z.object({ id: z.string(), status: z.literal("opened"), openedAt: z.string(), source: sourceSchema }),
  }, withErrors(async ({ handoffId }, ctx) => {
    const repo = repositoryOrThrow(repository);
    const scope = await repo.resolveHousehold(userIdFromContext(ctx));
    if (!scope) throw new HomeFixError("ONBOARDING_REQUIRED", "Create your household before opening a handoff.", false, "create_household");
    const handoff = await repo.markHandoffOpened(scope, handoffId);
    return { content: [{ type: "text", text: "The external handoff was opened by the user. Booking is not confirmed." }], structuredContent: handoff };
  }));

  server.tool({
    ...protectedTool,
    name: "record_booking_outcome",
    title: "Record booking outcome",
    description: "Record an outcome explicitly reported by the user and update the related maintenance state.",
    inputSchema: z.object({ handoffId: z.string().uuid(), outcome: z.enum(["booked", "not_booked", "cancelled", "needs_help"]), note: z.string().trim().max(500).optional() }).strict(),
    outputSchema: z.object({ handoffId: z.string(), handoffStatus: z.string(), maintenanceStatus: z.string(), source: sourceSchema }),
  }, withErrors(async ({ handoffId, outcome, note }, ctx) => {
    const repo = repositoryOrThrow(repository);
    const scope = await repo.resolveHousehold(userIdFromContext(ctx));
    if (!scope) throw new HomeFixError("ONBOARDING_REQUIRED", "Create your household before recording outcomes.", false, "create_household");
    const mapping = {
      booked: ["user_reported_booked", "booked_user_reported"],
      not_booked: ["user_reported_not_booked", "awaiting_user_choice"],
      cancelled: ["user_reported_cancelled", "cancelled_user_reported"],
      needs_help: ["user_reported_needs_help", "needs_attention"],
    } as const;
    const [handoffStatus, maintenanceStatus] = mapping[outcome];
    const result = await repo.recordBookingOutcome(scope, handoffId, handoffStatus, maintenanceStatus, note);
    return { content: [{ type: "text", text: "The user-reported booking outcome was saved." }], structuredContent: result };
  }));
}
