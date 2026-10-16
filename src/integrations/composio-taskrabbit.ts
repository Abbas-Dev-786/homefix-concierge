import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { HomeFixError } from "../domain/errors.js";

const TASKRABBIT_TOOLKIT = "taskrabbit_mcp";
const FRESHNESS_MS = 15 * 60 * 1000;
const allowedTaskrabbitHosts = new Set(["taskrabbit.com", "www.taskrabbit.com"]);

type JsonObject = Record<string, unknown>;
type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};

type DiscoveredTool = {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
};

export type ComposioSession = {
  client: Client;
  tools: DiscoveredTool[];
};

export type ServiceDiscoveryInput = {
  city?: string;
  region?: string;
  postalCode?: string;
  serviceQuery?: string;
};

export type AvailabilityInput = ServiceDiscoveryInput & {
  serviceCategory: string;
  desiredDate?: string;
  desiredTimeWindow?: string;
  scopingAnswers?: Record<string, string>;
};

export type BookingLinkInput = {
  taskTemplateId: string;
};

export type IntegrationCapability = "listServices" | "checkAvailability" | "createDeepLink";

export type IntegrationStatus = {
  status: "available" | "unavailable" | "error";
  capabilities: Partial<Record<IntegrationCapability, string>>;
  reason?: string;
};

export type ServiceDiscoveryResult = {
  services: Array<{ name: string; description: string | null }>;
  retrievedAt: string;
  source: "live_taskrabbit";
};

export type AvailabilityOption = {
  title: string;
  providerName: string | null;
  serviceCategory: string;
  locationLabel: string | null;
  estimateMin: number | null;
  estimateMax: number | null;
  priceLabel: string | null;
  currencyCode: string | null;
  availabilitySummary: string | null;
  availabilitySlots: Array<{ start?: string; end?: string; label?: string }>;
  scopingQuestions: Array<{ id: string; question: string; required?: boolean }>;
  taskTemplateId: string | null;
};

export type AvailabilityResult = {
  options: AvailabilityOption[];
  retrievedAt: string;
  expiresAt: string;
  source: "live_taskrabbit";
};

export type BookingLinkResult = {
  bookingUrl: string;
  retrievedAt: string;
  source: "live_taskrabbit";
};

export type SessionFactory = (userId: string) => Promise<ComposioSession>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\$?\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const parsed = Number(trimmed.replace(/^\$/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function valueAt(object: JsonObject, names: string[]): unknown {
  const entries = Object.entries(object);
  for (const name of names) {
    const exact = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (exact) return exact[1];
  }
  const normalizedNames = names.map((name) => name.replace(/[^a-z0-9]/gi, "").toLowerCase());
  const fuzzy = entries.find(([key]) => normalizedNames.includes(key.replace(/[^a-z0-9]/gi, "").toLowerCase()));
  return fuzzy?.[1];
}

function arrayFromPayload(value: unknown, names: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const object = asObject(value);
  if (!object) return [];
  for (const name of names) {
    const candidate = valueAt(object, [name]);
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function extractPayload(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  for (const item of result.content ?? []) {
    if (item.type !== "text" || !item.text) continue;
    try {
      return JSON.parse(item.text) as unknown;
    } catch {
      return item.text;
    }
  }
  return null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HomeFixError("INTEGRATION_UNAVAILABLE", "Taskrabbit did not respond before the outbound timeout.", true, "retry_taskrabbit")), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function toolText(tool: DiscoveredTool) {
  return `${tool.name} ${tool.description ?? ""}`.toLowerCase();
}

function pickCapability(tools: DiscoveredTool[], capability: IntegrationCapability): DiscoveredTool | null {
  const matches = tools.filter((tool) => {
    const haystack = toolText(tool);
    if (capability === "listServices") return haystack.includes("list") && haystack.includes("service") && (haystack.includes("supported") || haystack.includes("location"));
    if (capability === "checkAvailability") return haystack.includes("availability") && (haystack.includes("pricing") || haystack.includes("scoping"));
    return haystack.includes("deep link") || (haystack.includes("booking") && haystack.includes("link"));
  });
  return matches.length === 1 ? matches[0] : null;
}

function parseToolMap(raw: string | undefined): Partial<Record<IntegrationCapability, string>> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HomeFixError("INTEGRATION_UNAVAILABLE", "Taskrabbit tool mapping configuration is invalid JSON.", false, "fix_taskrabbit_tool_map");
  }
  const object = asObject(parsed);
  if (!object) throw new HomeFixError("INTEGRATION_UNAVAILABLE", "Taskrabbit tool mapping must be a JSON object.", false, "fix_taskrabbit_tool_map");
  const map: Partial<Record<IntegrationCapability, string>> = {};
  for (const capability of ["listServices", "checkAvailability", "createDeepLink"] as const) {
    if (object[capability] !== undefined && typeof object[capability] !== "string") {
      throw new HomeFixError("INTEGRATION_UNAVAILABLE", `Taskrabbit mapping for ${capability} must be a tool name.`, false, "fix_taskrabbit_tool_map");
    }
    if (typeof object[capability] === "string") map[capability] = object[capability] as string;
  }
  return map;
}

function findProperty(schema: JsonSchema | undefined, aliases: string[]): string | null {
  const properties = schema?.properties ?? {};
  const keys = Object.keys(properties);
  const normalized = aliases.map((alias) => alias.replace(/[^a-z0-9]/gi, "").toLowerCase());
  return keys.find((key) => normalized.includes(key.replace(/[^a-z0-9]/gi, "").toLowerCase())) ?? null;
}

function locationLabel(input: ServiceDiscoveryInput) {
  return [input.city, input.region, input.postalCode].filter(Boolean).join(", ") || null;
}

function mapArguments(tool: DiscoveredTool, capability: IntegrationCapability, input: ServiceDiscoveryInput | AvailabilityInput | BookingLinkInput): JsonObject {
  const schema = tool.inputSchema;
  const properties = schema?.properties ?? {};
  const args: JsonObject = {};
  const locationInput: ServiceDiscoveryInput = ("city" in input || "region" in input || "postalCode" in input) ? input : {};
  const location = locationLabel(locationInput);
  const locationKey = findProperty(schema, ["location", "market", "area"]);
  if (locationKey && location) {
    args[locationKey] = properties[locationKey]?.type === "object"
      ? Object.fromEntries([
          [findProperty(properties[locationKey], ["city"]), locationInput.city],
          [findProperty(properties[locationKey], ["region", "state"]), locationInput.region],
          [findProperty(properties[locationKey], ["postalCode", "postal_code", "zip", "zipCode"]), locationInput.postalCode],
        ].filter(([key, value]) => key && value))
      : location;
  }
  const cityKey = findProperty(schema, ["city", "town"]);
  const regionKey = findProperty(schema, ["region", "state", "stateCode"]);
  const postalKey = findProperty(schema, ["postalCode", "postal_code", "zip", "zipCode"]);
  if (cityKey && locationInput.city) args[cityKey] = locationInput.city;
  if (regionKey && locationInput.region) args[regionKey] = locationInput.region;
  if (postalKey && locationInput.postalCode) args[postalKey] = locationInput.postalCode;

  if (capability === "listServices") {
    const queryKey = findProperty(schema, ["serviceQuery", "query", "search", "service"]);
    if (queryKey && "serviceQuery" in input && input.serviceQuery) args[queryKey] = input.serviceQuery;
  }
  if (capability === "checkAvailability") {
    const availabilityInput = input as AvailabilityInput;
    const categoryKey = findProperty(schema, ["serviceCategory", "service_category", "serviceType", "category", "taskType", "service"]);
    if (categoryKey && "serviceCategory" in input) args[categoryKey] = input.serviceCategory;
    const dateKey = findProperty(schema, ["desiredDate", "desired_date", "date", "serviceDate"]);
    const timeKey = findProperty(schema, ["desiredTimeWindow", "desired_time_window", "timeWindow", "time"]);
    if (dateKey && availabilityInput.desiredDate) args[dateKey] = availabilityInput.desiredDate;
    if (timeKey && availabilityInput.desiredTimeWindow) args[timeKey] = availabilityInput.desiredTimeWindow;
    const answersKey = findProperty(schema, ["scopingAnswers", "scoping_answers", "answers", "responses"]);
    if (answersKey && availabilityInput.scopingAnswers) args[answersKey] = availabilityInput.scopingAnswers;
  }
  if (capability === "createDeepLink") {
    const templateKey = findProperty(schema, ["taskTemplateId", "task_template_id", "templateId", "taskId"]);
    if (templateKey && "taskTemplateId" in input) args[templateKey] = input.taskTemplateId;
  }

  for (const required of schema?.required ?? []) {
    if (args[required] === undefined || args[required] === "") {
      throw new HomeFixError("INTEGRATION_UNAVAILABLE", `Taskrabbit capability schema requires unsupported field ${required}.`, false, "provide_supported_taskrabbit_fields");
    }
  }
  return args;
}

function normalizeServices(payload: unknown): ServiceDiscoveryResult["services"] {
  const items = arrayFromPayload(payload, ["services", "supportedServices", "supported_services", "categories", "results", "items"]);
  return items.flatMap((item) => {
    if (typeof item === "string") return [{ name: item, description: null }];
    const object = asObject(item);
    if (!object) return [];
    const name = text(valueAt(object, ["name", "title", "label", "service", "serviceName", "category"]));
    return name ? [{ name, description: text(valueAt(object, ["description", "summary"])) }] : [];
  });
}

function numericRange(object: JsonObject): [number | null, number | null] {
  const min = number(valueAt(object, ["estimateMin", "estimate_min", "minPrice", "min_price", "minimumPrice"]));
  const max = number(valueAt(object, ["estimateMax", "estimate_max", "maxPrice", "max_price", "maximumPrice"]));
  if (min !== null || max !== null) return [min, max];
  const label = text(valueAt(object, ["price", "priceRange", "price_range", "estimate"]));
  const range = label?.match(/\$?([0-9]+(?:\.[0-9]{1,2})?)\s*(?:-|to)\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i);
  return range ? [Number(range[1]), Number(range[2])] : [null, null];
}

function normalizeOptions(payload: unknown, input: AvailabilityInput): AvailabilityOption[] {
  const items = arrayFromPayload(payload, ["options", "serviceOptions", "service_options", "results", "matches", "items"]);
  const candidates = items.length ? items : (asObject(payload) ? [payload] : []);
  return candidates.flatMap((item) => {
    const object = asObject(item);
    if (!object) return [];
    const [estimateMin, estimateMax] = numericRange(object);
    const slotsValue = valueAt(object, ["availabilitySlots", "availability_slots", "slots"]);
    const availabilitySlots = Array.isArray(slotsValue)
      ? slotsValue.flatMap((rawSlot) => {
          const value = asObject(rawSlot);
          if (!value) return [];
          const slot = { start: text(valueAt(value, ["start", "startsAt"])), end: text(valueAt(value, ["end", "endsAt"])), label: text(valueAt(value, ["label", "time"])) };
          return [{ ...(slot.start ? { start: slot.start } : {}), ...(slot.end ? { end: slot.end } : {}), ...(slot.label ? { label: slot.label } : {}) }];
        })
      : [];
    const questionsValue = valueAt(object, ["scopingQuestions", "scoping_questions", "questions"]);
    const scopingQuestions = Array.isArray(questionsValue)
      ? questionsValue.flatMap((question) => {
          const value = asObject(question);
          if (!value) return [];
          const questionText = text(valueAt(value, ["question", "text", "label"]));
          return questionText ? [{ id: text(valueAt(value, ["id", "key"])) ?? questionText, question: questionText, required: valueAt(value, ["required"]) === true ? true : undefined }] : [];
        })
      : [];
    return [{
      title: text(valueAt(object, ["title", "name", "service", "taskName"])) ?? "Taskrabbit service option",
      providerName: text(valueAt(object, ["providerName", "provider_name", "provider", "taskerName"])),
      serviceCategory: text(valueAt(object, ["serviceCategory", "service_category", "category"])) ?? input.serviceCategory,
      locationLabel: text(valueAt(object, ["locationLabel", "location", "market"])) ?? locationLabel(input),
      estimateMin,
      estimateMax,
      priceLabel: text(valueAt(object, ["priceLabel", "price_label", "price", "estimate", "priceRange"])),
      currencyCode: text(valueAt(object, ["currencyCode", "currency_code", "currency"])),
      availabilitySummary: text(valueAt(object, ["availabilitySummary", "availability_summary", "availability", "summary"])),
      availabilitySlots,
      scopingQuestions,
      taskTemplateId: text(valueAt(object, ["taskTemplateId", "task_template_id", "templateId", "taskId"])),
    }];
  });
}

export function isFreshProviderResult(retrievedAt: string, now = Date.now()) {
  const timestamp = Date.parse(retrievedAt);
  if (!Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  return age >= 0 && age < FRESHNESS_MS;
}

export function validateTaskrabbitUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HomeFixError("INTEGRATION_UNAVAILABLE", "Taskrabbit returned an invalid booking link.", false, "retry_taskrabbit_link");
  }
  if (url.protocol !== "https:" || url.username || url.password || !allowedTaskrabbitHosts.has(url.hostname.toLowerCase())) {
    throw new HomeFixError("INTEGRATION_UNAVAILABLE", "Taskrabbit returned a booking link on an untrusted domain.", false, "retry_taskrabbit_link");
  }
  return url.toString();
}

async function defaultSessionFactory(apiKey: string, baseUrl: string, timeoutMs: number, userId: string): Promise<ComposioSession> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/tool_router/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ user_id: userId, toolkits: [TASKRABBIT_TOOLKIT], mcp: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new HomeFixError("INTEGRATION_UNAVAILABLE", "Taskrabbit could not be reached through Composio.", true, "retry_taskrabbit");
  }
  if (!response.ok) throw new HomeFixError("INTEGRATION_UNAVAILABLE", "Composio could not create a Taskrabbit session.", response.status >= 500 || response.status === 429, "check_composio_connection");
  const body = await response.json() as JsonObject;
  const mcp = asObject(body.mcp);
  const mcpUrl = text(mcp?.url);
  if (!mcpUrl) throw new HomeFixError("INTEGRATION_UNAVAILABLE", "Composio did not return a Taskrabbit MCP endpoint.", true, "retry_taskrabbit");
  const mcpHeaders = asObject(mcp?.headers) ?? {};
  const client = new Client({ name: "homefix-taskrabbit-adapter", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { "x-api-key": apiKey, ...Object.fromEntries(Object.entries(mcpHeaders).filter(([, value]) => typeof value === "string")) as Record<string, string> }, redirect: "error" },
  });
  try {
    await client.connect(transport);
    const tools: DiscoveredTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as JsonSchema })));
      cursor = page.nextCursor;
    } while (cursor);
    return { client, tools };
  } catch {
    await client.close().catch(() => {});
    throw new HomeFixError("INTEGRATION_UNAVAILABLE", "Composio Taskrabbit tool discovery failed.", true, "retry_taskrabbit");
  }
}

export class ComposioTaskrabbitAdapter {
  private readonly sessions = new Map<string, Promise<ComposioSession>>();
  private readonly toolMap: Partial<Record<IntegrationCapability, string>>;
  private readonly sessionFactory: SessionFactory;

  constructor(private readonly options: { apiKey?: string; baseUrl?: string; toolMapJson?: string; timeoutMs?: number; sessionFactory?: SessionFactory }) {
    this.toolMap = parseToolMap(options.toolMapJson);
    this.sessionFactory = options.sessionFactory ?? ((userId) => defaultSessionFactory(
      options.apiKey ?? "",
      options.baseUrl ?? "https://backend.composio.dev/api/v3.1",
      options.timeoutMs ?? 12000,
      userId,
    ));
  }

  private async session(userId: string) {
    if (!this.options.apiKey && !this.options.sessionFactory) throw new HomeFixError("INTEGRATION_UNAVAILABLE", "Composio is not configured for this deployment.", false, "configure_composio_api_key");
    let session = this.sessions.get(userId);
    if (!session) {
      session = this.sessionFactory(userId);
      this.sessions.set(userId, session);
    }
    try {
      return await session;
    } catch (error) {
      this.sessions.delete(userId);
      throw error;
    }
  }

  private capabilities(session: ComposioSession) {
    const result: Partial<Record<IntegrationCapability, DiscoveredTool>> = {};
    for (const capability of ["listServices", "checkAvailability", "createDeepLink"] as const) {
      const mapped = this.toolMap[capability];
      const tool = mapped ? session.tools.find((candidate) => candidate.name === mapped) ?? null : pickCapability(session.tools, capability);
      if (tool) result[capability] = tool;
    }
    return result;
  }

  async getStatus(userId: string): Promise<IntegrationStatus> {
    try {
      const session = await this.session(userId);
      const capabilities = this.capabilities(session);
      const names = Object.fromEntries(Object.entries(capabilities).map(([key, tool]) => [key, tool.name])) as Partial<Record<IntegrationCapability, string>>;
      const missing = (["listServices", "checkAvailability", "createDeepLink"] as const).filter((capability) => !capabilities[capability]);
      return missing.length ? { status: "unavailable", capabilities: names, reason: `Composio Taskrabbit capability unavailable: ${missing.join(", ")}.` } : { status: "available", capabilities: names };
    } catch (error) {
      const normalized = error instanceof HomeFixError ? error : new HomeFixError("INTEGRATION_UNAVAILABLE", "Composio Taskrabbit integration is unavailable.", true, "retry_taskrabbit");
      return { status: "error", capabilities: {}, reason: normalized.message };
    }
  }

  private async call(userId: string, capability: IntegrationCapability, input: ServiceDiscoveryInput | AvailabilityInput | BookingLinkInput) {
    const session = await this.session(userId);
    const tool = this.capabilities(session)[capability];
    if (!tool) throw new HomeFixError("INTEGRATION_UNAVAILABLE", `Taskrabbit capability ${capability} is unavailable.`, false, "check_taskrabbit_status");
    const args = mapArguments(tool, capability, input);
    let result;
    try {
      result = await withTimeout(session.client.callTool({ name: tool.name, arguments: args }), this.options.timeoutMs ?? 12000);
    } catch (error) {
      if (error instanceof HomeFixError) throw error;
      throw new HomeFixError("INTEGRATION_UNAVAILABLE", "Taskrabbit could not complete that live request.", true, "retry_taskrabbit");
    }
    if (result.isError) throw new HomeFixError("INTEGRATION_UNAVAILABLE", "Taskrabbit could not complete that live request.", true, "retry_taskrabbit");
    return extractPayload(result as { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> });
  }

  async listSupportedServices(userId: string, input: ServiceDiscoveryInput): Promise<ServiceDiscoveryResult> {
    const retrievedAt = new Date().toISOString();
    const payload = await this.call(userId, "listServices", input);
    return { services: normalizeServices(payload), retrievedAt, source: "live_taskrabbit" };
  }

  async checkAvailability(userId: string, input: AvailabilityInput): Promise<AvailabilityResult> {
    const retrievedAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(retrievedAt) + FRESHNESS_MS).toISOString();
    const payload = await this.call(userId, "checkAvailability", input);
    return { options: normalizeOptions(payload, input), retrievedAt, expiresAt, source: "live_taskrabbit" };
  }

  async createBookingLink(userId: string, input: BookingLinkInput): Promise<BookingLinkResult> {
    const retrievedAt = new Date().toISOString();
    const payload = await this.call(userId, "createDeepLink", input);
    const object = asObject(payload);
    const candidate = typeof payload === "string" ? payload : text(valueAt(object ?? {}, ["bookingUrl", "booking_url", "deepLink", "deep_link", "url", "link"]));
    if (!candidate) throw new HomeFixError("INTEGRATION_UNAVAILABLE", "Taskrabbit did not return a booking link.", true, "retry_taskrabbit_link");
    return { bookingUrl: validateTaskrabbitUrl(candidate), retrievedAt, source: "live_taskrabbit" };
  }
}
