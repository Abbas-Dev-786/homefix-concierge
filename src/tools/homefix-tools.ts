import { z } from "zod";
import type { MCPServer } from "mcp-use";
import type { SupabaseOAuthUser } from "mcp-use/oauth/supabase";

import { assertMaintenanceTransition, maintenanceStatuses } from "../domain/maintenance-state.js";
import { HomeFixError, errorResult } from "../domain/errors.js";
import { ComposioTaskrabbitAdapter, isFreshProviderResult } from "../integrations/composio-taskrabbit.js";
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

const serviceDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => value >= new Date().toISOString().slice(0, 10),
  "desiredDate must be today or a future date"
);

const taskrabbitLocation = (input: { city?: string; region?: string; postalCode?: string }) =>
  Boolean(input.postalCode || (input.city && input.region));

const scopingAnswerSchema = z.union([
  z.string().trim().max(500),
  z.boolean(),
  z.number().finite(),
]);

function normalizeScopingAnswers(answers: Record<string, string | boolean | number> | undefined) {
  if (!answers) return undefined;
  return Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, typeof value === "string" ? value : String(value)]));
}

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

function taskrabbitOrThrow(taskrabbit: ComposioTaskrabbitAdapter | undefined) {
  if (!taskrabbit) {
    throw new HomeFixError(
      "INTEGRATION_UNAVAILABLE",
      "Live Taskrabbit is not configured on this deployment.",
      false,
      "configure_composio_api_key"
    );
  }
  return taskrabbit;
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
  repository: HomeFixRepository | undefined,
  taskrabbit: ComposioTaskrabbitAdapter | undefined
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
      taskrabbit: z.object({ status: z.enum(["available", "unavailable", "error"]), reason: z.string().nullable(), capabilities: z.record(z.string(), z.string()).optional() }),
      source: sourceSchema,
    }),
  }, withErrors(async (_, ctx) => {
    const userId = userIdFromContext(ctx);
    const dashboard = await repositoryOrThrow(repository).dashboard(userId);
    const taskrabbitStatus = taskrabbit ? await taskrabbit.getStatus(userId) : { status: "unavailable" as const, reason: "Live Taskrabbit capability is not configured.", capabilities: {} };
    return {
      content: [{ type: "text", text: dashboard.onboardingRequired ? "HomeFix onboarding is required." : "HomeFix dashboard loaded." }],
      structuredContent: { ...dashboard, taskrabbit: { ...taskrabbitStatus, reason: taskrabbitStatus.reason ?? null } },
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

  server.tool({
    ...protectedTool,
    name: "list_supported_services",
    title: "List supported Taskrabbit services",
    description: "Ask the live Composio Taskrabbit capability which services are supported in the user-confirmed market. Do not infer coverage.",
    inputSchema: z.object({ city: z.string().trim().max(120).optional(), region: z.string().trim().max(120).optional(), postalCode: z.string().trim().regex(/^\d{5}$/, "postalCode must be a 5-digit US postal code").optional(), serviceQuery: z.string().trim().max(120).optional() }).strict().refine(taskrabbitLocation, "Provide either a city and state/region or a 5-digit postal code before searching Taskrabbit."),
    outputSchema: z.object({ services: z.array(z.object({ name: z.string(), description: z.string().nullable() })), retrievedAt: z.string(), source: z.literal("live_taskrabbit") }),
  }, withErrors(async (input, ctx) => {
    const adapter = taskrabbitOrThrow(taskrabbit);
    const result = await adapter.listSupportedServices(userIdFromContext(ctx), input);
    return { content: [{ type: "text", text: `${result.services.length} live Taskrabbit service(s) found.` }], structuredContent: result };
  }));

  server.tool({
    ...protectedTool,
    name: "find_service_options",
    title: "Find live Taskrabbit options",
    description: "Check live Taskrabbit availability, pricing, and scoping questions for one persisted repair in a user-confirmed market. Provider results are timestamped and may be empty.",
    inputSchema: z.object({ requestId: z.string().uuid(), serviceCategory: z.string().trim().min(1).max(120), city: z.string().trim().max(120).optional(), region: z.string().trim().max(120).optional(), postalCode: z.string().trim().regex(/^\d{5}$/, "postalCode must be a 5-digit US postal code").optional(), desiredDate: serviceDateSchema.optional(), desiredTimeWindow: z.string().trim().max(120).optional(), scopingAnswers: z.record(z.string(), scopingAnswerSchema).optional() }).strict().refine(taskrabbitLocation, "Provide either a city and state/region or a 5-digit postal code before searching Taskrabbit."),
    outputSchema: z.object({ status: z.enum(["available", "empty"]), searchId: z.string(), options: z.array(z.object({ id: z.string(), title: z.string(), providerName: z.string().nullable(), serviceCategory: z.string(), locationLabel: z.string().nullable(), estimateMin: z.number().nullable(), estimateMax: z.number().nullable(), priceLabel: z.string().nullable(), currencyCode: z.string().nullable(), availabilitySummary: z.string().nullable(), availabilitySlots: z.array(z.unknown()), scopingQuestions: z.array(z.unknown()), taskTemplateId: z.string().nullable(), retrievedAt: z.string(), expiresAt: z.string(), source: z.literal("live_taskrabbit") })), retrievedAt: z.string(), expiresAt: z.string(), source: z.literal("live_taskrabbit") }),
  }, withErrors(async (input, ctx) => {
    const repo = repositoryOrThrow(repository);
    const adapter = taskrabbitOrThrow(taskrabbit);
    const userId = userIdFromContext(ctx);
    const scope = await repo.resolveHousehold(userId);
    if (!scope) throw new HomeFixError("ONBOARDING_REQUIRED", "Create your household before searching for repair options.", false, "create_household");
    const request = await repo.getRequest(scope, input.requestId);
    if (!request) throw new HomeFixError("NOT_FOUND", "That maintenance request was not found in your household.", false, "refresh_dashboard");
    await repo.updateRequestStatus(scope, request.id, "searching", undefined, "system", "agent", "live_taskrabbit");
    const normalizedScopingAnswers = normalizeScopingAnswers(input.scopingAnswers);
    const locationSnapshot = { city: input.city ?? "", region: input.region ?? "", postalCode: input.postalCode ?? "" };
    const searchCriteria = { serviceCategory: input.serviceCategory, taskTitle: request.title, taskDescription: request.description, city: input.city ?? null, region: input.region ?? null, postalCode: input.postalCode ?? null, desiredDate: input.desiredDate ?? null, desiredTimeWindow: input.desiredTimeWindow ?? null, scopingAnswers: normalizedScopingAnswers ?? null };
    let result;
    try {
      result = await adapter.checkAvailability(userId, { ...input, taskTitle: request.title, taskDescription: request.description, scopingAnswers: normalizedScopingAnswers });
    } catch (error) {
      await repo.createServiceSearch(scope, { requestId: request.id, locationSnapshot, searchCriteria, status: "error", resultCount: 0, errorCode: error instanceof HomeFixError ? error.code : "INTEGRATION_UNAVAILABLE" });
      await repo.updateRequestStatus(scope, request.id, "needs_attention", "Live Taskrabbit search failed; no provider options were created.", "system", "agent", "live_taskrabbit").catch(() => {});
      throw error;
    }
    const search = await repo.createServiceSearch(scope, { requestId: request.id, locationSnapshot, searchCriteria, status: result.options.length ? "completed" : "empty", resultCount: result.options.length, retrievedAt: result.retrievedAt });
    const options = await repo.createServiceOptions(scope, result.options.map((option) => ({ ...option, serviceSearchId: search.id, requestId: request.id, retrievedAt: result.retrievedAt, expiresAt: result.expiresAt })));
    if (options.length) await repo.updateRequestStatus(scope, request.id, "options_ready", undefined, "system", "agent", "live_taskrabbit");
    else await repo.updateRequestStatus(scope, request.id, "needs_attention", "Taskrabbit returned no matching options.", "system", "agent", "live_taskrabbit");
    return { content: [{ type: "text", text: options.length ? `${options.length} live Taskrabbit option(s) found.` : "Taskrabbit returned no matching options." }], structuredContent: { status: options.length ? "available" as const : "empty" as const, searchId: search.id, options, retrievedAt: result.retrievedAt, expiresAt: result.expiresAt, source: "live_taskrabbit" as const } };
  }));

  server.tool({
    ...protectedTool,
    name: "create_booking_handoff",
    title: "Prepare Taskrabbit booking handoff",
    description: "Prepare a validated live Taskrabbit link after the user selects one fresh option. This saves a ready handoff and never opens the external page or claims booking.",
    inputSchema: z.object({ requestId: z.string().uuid(), serviceOptionId: z.string().uuid(), idempotencyKey: z.string().trim().min(8).max(128) }).strict(),
    outputSchema: z.object({ id: z.string(), status: z.literal("ready"), bookingUrl: z.string().url(), retrievedAt: z.string(), source: sourceSchema }),
  }, withErrors(async ({ requestId, serviceOptionId, idempotencyKey }, ctx) => {
    const repo = repositoryOrThrow(repository);
    const adapter = taskrabbitOrThrow(taskrabbit);
    const userId = userIdFromContext(ctx);
    const scope = await repo.resolveHousehold(userId);
    if (!scope) throw new HomeFixError("ONBOARDING_REQUIRED", "Create your household before preparing a booking handoff.", false, "create_household");
    const existing = await repo.existingBookingHandoff(scope, idempotencyKey);
    if (existing) return { content: [{ type: "text", text: "The existing Taskrabbit handoff is ready. It has not been opened." }], structuredContent: { ...existing, status: "ready" as const } };
    let options = await repo.listOptions(scope, requestId, [serviceOptionId]);
    let selected = options[0];
    if (!selected) throw new HomeFixError("NOT_FOUND", "That live service option was not found for this repair.", false, "refresh_options");
    if (!isFreshProviderResult(selected.retrievedAt)) {
      const latest = await repo.latestSearch(scope, requestId);
      const criteria = latest?.search_criteria && typeof latest.search_criteria === "object" ? latest.search_criteria as Record<string, unknown> : null;
      if (!criteria || typeof criteria.serviceCategory !== "string") throw new HomeFixError("INVALID_STATE", "This provider result is stale and cannot be refreshed automatically. Run a new live search.", false, "refresh_options");
      const refreshed = await adapter.checkAvailability(userId, {
        serviceCategory: criteria.serviceCategory,
        taskTitle: typeof criteria.taskTitle === "string" ? criteria.taskTitle : undefined,
        taskDescription: typeof criteria.taskDescription === "string" ? criteria.taskDescription : undefined,
        city: typeof criteria.city === "string" ? criteria.city : undefined,
        region: typeof criteria.region === "string" ? criteria.region : undefined,
        postalCode: typeof criteria.postalCode === "string" ? criteria.postalCode : undefined,
        desiredDate: typeof criteria.desiredDate === "string" ? criteria.desiredDate : undefined,
        desiredTimeWindow: typeof criteria.desiredTimeWindow === "string" ? criteria.desiredTimeWindow : undefined,
        scopingAnswers: criteria.scopingAnswers && typeof criteria.scopingAnswers === "object" ? criteria.scopingAnswers as Record<string, string> : undefined,
      });
      const freshSearch = await repo.createServiceSearch(scope, { requestId, locationSnapshot: latest?.location_snapshot && typeof latest.location_snapshot === "object" ? latest.location_snapshot as Record<string, string> : {}, searchCriteria: criteria, status: refreshed.options.length ? "completed" : "empty", resultCount: refreshed.options.length, retrievedAt: refreshed.retrievedAt });
      await repo.createServiceOptions(scope, refreshed.options.map((option) => ({ ...option, serviceSearchId: freshSearch.id, requestId, retrievedAt: refreshed.retrievedAt, expiresAt: refreshed.expiresAt })));
      throw new HomeFixError("INVALID_STATE", "The selected Taskrabbit result expired. Fresh options were retrieved; compare and select one again.", false, "compare_fresh_options");
    }
    const bookingContext = selected.bookingContext && typeof selected.bookingContext === "object" ? selected.bookingContext : null;
    const categoryId = bookingContext && typeof bookingContext.categoryId === "string" ? bookingContext.categoryId : selected.taskTemplateId;
    if (!categoryId) throw new HomeFixError("INTEGRATION_UNAVAILABLE", "The selected Taskrabbit option has no provider category ID for link generation.", false, "choose_another_option");
    const link = await adapter.createBookingLink(userId, {
      categoryId,
      locale: bookingContext && typeof bookingContext.locale === "string" ? bookingContext.locale : "en-US",
      questionnaire: bookingContext && Array.isArray(bookingContext.questionnaire) ? bookingContext.questionnaire : [],
      location: bookingContext && bookingContext.location && typeof bookingContext.location === "object" ? bookingContext.location as { address: string; postal_code: string; lat: number; lng: number } : undefined,
      taskTemplateId: selected.taskTemplateId ?? undefined,
    });
    const handoff = await repo.createBookingHandoff(scope, requestId, serviceOptionId, link.bookingUrl, idempotencyKey, link.retrievedAt);
    return { content: [{ type: "text", text: "A live Taskrabbit handoff is ready. Ask the user to click Continue to Taskrabbit before opening it." }], structuredContent: handoff };
  }));

  server.tool({
    ...protectedTool,
    name: "get_taskrabbit_status",
    title: "Get Taskrabbit status",
    description: "Report whether the live Taskrabbit capability is available without exposing credentials or provider payloads.",
    inputSchema: z.object({}),
    outputSchema: z.object({ status: z.enum(["available", "unavailable", "error"]), reason: z.string().nullable(), capabilities: z.record(z.string(), z.string()), source: z.literal("live_taskrabbit") }),
  }, withErrors(async (_, ctx) => {
    const status = await taskrabbitOrThrow(taskrabbit).getStatus(userIdFromContext(ctx));
    return {
      content: [{ type: "text", text: status.status === "available" ? "Live Taskrabbit is available." : status.reason ?? "Live Taskrabbit is unavailable." }],
      structuredContent: { status: status.status, reason: status.reason ?? null, capabilities: status.capabilities, source: "live_taskrabbit" as const },
    };
  }));

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
    name: "evaluate_repair_group_budget",
    title: "Evaluate repair group budget",
    description: "Calculate a repair group total only when every selected live option has a numeric upper estimate in one common currency. Missing estimates or mixed currencies remain unknown.",
    inputSchema: z.object({ groupId: z.string().uuid(), selections: z.array(z.object({ requestId: z.string().uuid(), optionId: z.string().uuid() }).strict()).min(1).max(20) }).strict(),
    outputSchema: z.object({ groupId: z.string(), currencyCode: z.string().nullable(), budgetMax: z.number().nullable(), totalEstimateMax: z.number().nullable(), fitsBudget: z.boolean().nullable(), status: z.enum(["known", "unknown"]), source: sourceSchema }),
  }, withErrors(async ({ groupId, selections }, ctx) => {
    const repo = repositoryOrThrow(repository);
    const scope = await repo.resolveHousehold(userIdFromContext(ctx));
    if (!scope) throw new HomeFixError("ONBOARDING_REQUIRED", "Create your household before evaluating a repair group.", false, "create_household");
    const result = await repo.evaluateGroupBudget(scope, groupId, selections);
    return { content: [{ type: "text", text: result.status === "known" ? "The repair group total was calculated from live option estimates." : "The repair group total is unknown because a complete common-currency estimate is unavailable." }], structuredContent: result };
  }));

  server.tool({
    ...protectedTool,
    name: "record_handoff_opened",
    title: "Record handoff opened",
    description: "Record that the user initiated an external handoff for a ready option; this never means the repair was booked.",
    inputSchema: z.object({ handoffId: z.string().uuid(), idempotencyKey: z.string().trim().min(8).max(128) }).strict(),
    outputSchema: z.object({ id: z.string(), status: z.literal("opened"), openedAt: z.string(), source: sourceSchema }),
  }, withErrors(async ({ handoffId, idempotencyKey }, ctx) => {
    const repo = repositoryOrThrow(repository);
    const scope = await repo.resolveHousehold(userIdFromContext(ctx));
    if (!scope) throw new HomeFixError("ONBOARDING_REQUIRED", "Create your household before opening a handoff.", false, "create_household");
    const handoff = await repo.markHandoffOpened(scope, handoffId, idempotencyKey);
    return { content: [{ type: "text", text: "The external handoff was opened by the user. Booking is not confirmed." }], structuredContent: handoff };
  }));

  server.tool({
    ...protectedTool,
    name: "get_activity",
    title: "Get HomeFix activity",
    description: "Return recent sanitized HomeFix events for the authenticated household. Every entry comes from a persisted operation; no illustrative traces are created.",
    inputSchema: z.object({ requestId: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).default(50) }).strict(),
    outputSchema: z.object({ events: z.array(z.object({ id: z.string(), maintenanceRequestId: z.string().nullable(), bookingHandoffId: z.string().nullable(), eventType: z.string(), actorType: z.string(), sourceMode: z.string(), payload: z.unknown(), createdAt: z.string() })), source: sourceSchema }),
  }, withErrors(async ({ requestId, limit }, ctx) => {
    const repo = repositoryOrThrow(repository);
    const scope = await repo.resolveHousehold(userIdFromContext(ctx));
    if (!scope) return { content: [{ type: "text", text: "No household activity is available yet." }], structuredContent: { events: [], source: "supabase" as const } };
    const rows = (await repo.listEvents(scope, requestId)).slice(0, limit);
    const events = rows.map((row) => ({ id: row.id, maintenanceRequestId: row.maintenance_request_id ?? null, bookingHandoffId: row.booking_handoff_id ?? null, eventType: row.event_type, actorType: row.actor_type, sourceMode: row.source_mode, payload: row.payload_sanitized ?? {}, createdAt: row.created_at }));
    return { content: [{ type: "text", text: `${events.length} persisted HomeFix event(s) loaded.` }], structuredContent: { events, source: "supabase" as const } };
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
