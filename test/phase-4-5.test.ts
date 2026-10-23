import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ComposioTaskrabbitAdapter,
  isFreshProviderResult,
  validateTaskrabbitUrl,
  type ComposioSession,
} from "../src/integrations/composio-taskrabbit.js";
import { HomeFixError } from "../src/domain/errors.js";

const now = Date.parse("2026-10-16T12:00:00.000Z");

function fakeAdapter(payloads: Record<string, unknown>) {
  const tools: ComposioSession["tools"] = [
    { name: "list_supported_services", description: "List supported services", inputSchema: { type: "object", properties: { postalCode: { type: "string" } }, required: ["postalCode"] } },
    { name: "check_availability", description: "Check availability pricing and scoping", inputSchema: { type: "object", properties: { postalCode: { type: "string" }, serviceCategory: { type: "string" } }, required: ["postalCode", "serviceCategory"] } },
    { name: "generate_deep_link", description: "Generate a booking deep link", inputSchema: { type: "object", properties: { taskTemplateId: { type: "string" } }, required: ["taskTemplateId"] } },
  ];
  const client = {
    callTool: async ({ name }: { name: string }) => ({ structuredContent: payloads[name] }),
  } as unknown as ComposioSession["client"];
  return new ComposioTaskrabbitAdapter({
    toolMapJson: JSON.stringify({ listServices: "list_supported_services", checkAvailability: "check_availability", createDeepLink: "generate_deep_link" }),
    sessionFactory: async () => ({ client, tools }),
  });
}

function currentTaskrabbitAdapter(calls: Array<{ name: string; arguments: Record<string, unknown> }>) {
  const tools: ComposioSession["tools"] = [
    { name: "TASKRABBIT_MCP_LIST_SUPPORTED_SERVICES", description: "List Taskrabbit services available in a location", inputSchema: { type: "object", properties: { city: { type: "string" }, state: { type: "string" }, postalCode: { type: "string" } }, anyOf: [{ required: ["city", "state"] }, { required: ["postalCode"] }] } },
    { name: "TASKRABBIT_MCP_CHECK_SERVICE_AVAILABILITY", description: "Checks availability, pricing, and scoping questions", inputSchema: { type: "object", properties: { city: { type: "string" }, state: { type: "string" }, postalCode: { type: "string" }, service: { type: "string" } }, required: ["service"], anyOf: [{ required: ["city", "state"] }, { required: ["postalCode"] }] } },
    { name: "TASKRABBIT_MCP_GENERATE_DEEP_LINK", description: "Generate a pre-filled Taskrabbit booking deep link", inputSchema: { type: "object", properties: { locale: { type: "string" }, categoryId: { type: "string" }, questionnaire: { type: "array" } }, required: ["locale", "categoryId", "questionnaire"] } },
  ];
  const client = {
    callTool: async ({ name, arguments: input }: { name: string; arguments: Record<string, unknown> }) => {
      calls.push({ name, arguments: input });
      if (name === "TASKRABBIT_MCP_CHECK_SERVICE_AVAILABILITY") {
        return { structuredContent: { options: [{ title: "Assembly", categoryId: "furniture_assembly", location: { address: "Pune, MH", postal_code: "411001", lat: 18.5204, lng: 73.8567 }, scopingQuestions: [{ param: "item_count", question: "How many items?" }] }] } };
      }
      return { structuredContent: { deepLink: "https://www.taskrabbit.com/book" } };
    },
  } as unknown as ComposioSession["client"];
  return new ComposioTaskrabbitAdapter({ sessionFactory: async () => ({ client, tools }) });
}

test("provider results expire at exactly fifteen minutes", () => {
  assert.equal(isFreshProviderResult(new Date(now - 14 * 60 * 1000 - 999).toISOString(), now), true);
  assert.equal(isFreshProviderResult(new Date(now - 15 * 60 * 1000).toISOString(), now), false);
  assert.equal(isFreshProviderResult(new Date(now + 1000).toISOString(), now), false);
});

test("adapter normalizes live services, options, and booking links", async () => {
  const adapter = fakeAdapter({
    list_supported_services: { services: [{ name: "Furniture Assembly", description: "Assembly help" }] },
    check_availability: { options: [{ title: "Assembly option", providerName: "Tasker", price: "$80-$120", availability: "Tomorrow", taskTemplateId: "template-1" }] },
    generate_deep_link: { deepLink: "https://www.taskrabbit.com/tasks/template-1" },
  });
  const status = await adapter.getStatus("user-a");
  assert.equal(status.status, "available");
  const services = await adapter.listSupportedServices("user-a", { postalCode: "411001" });
  assert.equal(services.services[0]?.name, "Furniture Assembly");
  const options = await adapter.checkAvailability("user-a", { postalCode: "411001", serviceCategory: "assembly" });
  assert.equal(options.options[0]?.estimateMin, 80);
  assert.equal(options.options[0]?.estimateMax, 120);
  const link = await adapter.createBookingLink("user-a", { taskTemplateId: "template-1" });
  assert.equal(link.bookingUrl, "https://www.taskrabbit.com/tasks/template-1");
});

test("adapter maps the current Taskrabbit schemas and deep-link questionnaire", async () => {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const adapter = currentTaskrabbitAdapter(calls);
  const availability = await adapter.checkAvailability("user-a", {
    postalCode: "411001",
    serviceCategory: "assemble furniture",
    taskTitle: "Leaking kitchen tap",
    taskDescription: "The kitchen tap is actively spraying water.",
    scopingAnswers: { item_count: "2" },
  });
  assert.deepEqual(calls[0]?.arguments, { postalCode: "411001", service: "assemble furniture" });
  assert.equal(availability.options[0]?.taskTemplateId, "furniture_assembly");
  assert.deepEqual(availability.options[0]?.bookingContext.questionnaire, [{ param: "item_count", question: "How many items?", answer: "2" }]);
  assert.deepEqual(availability.options[0]?.bookingContext.location, { address: "Pune, MH", postal_code: "411001", lat: 18.5204, lng: 73.8567 });

  await adapter.createBookingLink("user-a", {
    categoryId: "furniture_assembly",
    locale: "en-US",
    questionnaire: availability.options[0]?.bookingContext.questionnaire,
    location: availability.options[0]?.bookingContext.location,
  });
  assert.deepEqual(calls[1]?.arguments, {
    locale: "en-US",
    categoryId: "furniture_assembly",
    questionnaire: [{ param: "item_count", question: "How many items?", answer: "2" }],
    location: { address: "Pune, MH", postal_code: "411001", lat: 18.5204, lng: 73.8567 },
  });
});

test("adapter pre-fills provider questionnaire fields from the HomeFix repair", async () => {
  const tools: ComposioSession["tools"] = [
    { name: "TASKRABBIT_MCP_CHECK_SERVICE_AVAILABILITY", inputSchema: { type: "object", properties: { postalCode: { type: "string" }, service: { type: "string" } }, required: ["service"] } },
  ];
  const client = {
    callTool: async () => ({ structuredContent: { available: true, categoryId: "plumbing_help", location: { address: "New York City, NY", postal_code: "10001", lat: 40.7484, lng: -73.9967 }, scopingQuestions: [
      { id: "generic_task_description", param: "description", question: "Tell us the details of your task", optional: false },
      { id: "service_date", param: "service_date", question: "What date do you need?", optional: true },
      { id: "service_time", param: "time_window", question: "What time works?", optional: true },
    ] } }),
  } as unknown as ComposioSession["client"];
  const adapter = new ComposioTaskrabbitAdapter({ sessionFactory: async () => ({ client, tools }) });
  const result = await adapter.checkAvailability("user-a", {
    postalCode: "10001",
    serviceCategory: "plumbing",
    taskTitle: "Leaking kitchen tap",
    taskDescription: "The kitchen tap is actively spraying water.",
    desiredDate: "2026-10-20",
    desiredTimeWindow: "11:30 AM-12:30 PM",
  });
  assert.deepEqual(result.options[0]?.bookingContext.questionnaire, [
    { param: "description", question: "Tell us the details of your task", answer: "Leaking kitchen tap\n\nThe kitchen tap is actively spraying water." },
    { param: "service_date", question: "What date do you need?", answer: "2026-10-20" },
    { param: "time_window", question: "What time works?", answer: "11:30 AM-12:30 PM" },
  ]);
});

test("adapter uses the official session execute result shape", async () => {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const tools: ComposioSession["tools"] = [
    { name: "TASKRABBIT_MCP_LIST_SUPPORTED_SERVICES", description: "List Taskrabbit services", inputSchema: { type: "object", properties: { postalCode: { type: "string" } } } },
  ];
  const session: ComposioSession = {
    tools,
    execute: async (name, args) => {
      calls.push({ name, arguments: args });
      return { data: { services: [{ categoryId: "furniture_assembly", label: "Furniture Assembly" }] }, error: null, resultType: "completed" };
    },
  };
  const adapter = new ComposioTaskrabbitAdapter({ sessionFactory: async () => session });
  const result = await adapter.listSupportedServices("user-a", { postalCode: "10001" });
  assert.equal(result.services[0]?.name, "Furniture Assembly");
  assert.deepEqual(calls[0]?.arguments, { postalCode: "10001" });
});

test("adapter unwraps a successful session execute MCP envelope", async () => {
  const tools: ComposioSession["tools"] = [
    { name: "TASKRABBIT_MCP_CHECK_SERVICE_AVAILABILITY", description: "Check availability pricing and scoping", inputSchema: { type: "object", properties: { postalCode: { type: "string" }, service: { type: "string" } }, required: ["service"] } },
  ];
  const session: ComposioSession = {
    tools,
    execute: async () => ({
      data: {
        structuredContent: {
          options: [{ title: "Plumbing", taskTemplateId: "plumbing_help", available: true }],
        },
      },
      error: null,
      logId: "log-availability-1",
      resultType: "completed",
    }),
  };
  const adapter = new ComposioTaskrabbitAdapter({ sessionFactory: async () => session });
  const result = await adapter.checkAvailability("user-a", { postalCode: "10001", serviceCategory: "plumbing" });
  assert.equal(result.options[0]?.title, "Plumbing");
  assert.equal(result.options[0]?.taskTemplateId, "plumbing_help");
});

test("adapter aborts a provider execution that exceeds its configured timeout", async () => {
  const tools: ComposioSession["tools"] = [
    { name: "TASKRABBIT_MCP_CHECK_SERVICE_AVAILABILITY", description: "Check availability pricing and scoping", inputSchema: { type: "object", properties: { postalCode: { type: "string" }, service: { type: "string" } }, required: ["service"] } },
  ];
  const session: ComposioSession = {
    tools,
    execute: async (_name, _arguments, signal) => await new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  };
  const adapter = new ComposioTaskrabbitAdapter({ executionTimeoutMs: 20, sessionFactory: async () => session });
  await assert.rejects(
    () => adapter.checkAvailability("user-a", { postalCode: "10001", serviceCategory: "plumbing" }),
    (error: unknown) => error instanceof HomeFixError && error.message.includes("provider execution timeout") && error.retryable,
  );
});

test("adapter does not treat a failed Composio execution as an empty search", async () => {
  const tools: ComposioSession["tools"] = [
    { name: "TASKRABBIT_MCP_CHECK_SERVICE_AVAILABILITY", description: "Check availability pricing and scoping", inputSchema: { type: "object", properties: { postalCode: { type: "string" }, service: { type: "string" } }, required: ["service"] } },
  ];
  const session: ComposioSession = {
    tools,
    execute: async () => ({ data: {}, error: null, logId: "log-availability-failed", resultType: "failed" }),
  };
  const adapter = new ComposioTaskrabbitAdapter({ sessionFactory: async () => session });
  await assert.rejects(
    () => adapter.checkAvailability("user-a", { postalCode: "10001", serviceCategory: "plumbing" }),
    (error: unknown) => error instanceof HomeFixError && error.code === "INTEGRATION_UNAVAILABLE",
  );
});

test("adapter rejects missing required provider fields and unsafe links", async () => {
  const adapter = fakeAdapter({ list_supported_services: { services: [] }, check_availability: { options: [] }, generate_deep_link: { deepLink: "https://evil.example/book" } });
  await assert.rejects(
    () => adapter.listSupportedServices("user-a", {}),
    (error: unknown) => error instanceof HomeFixError && error.code === "INTEGRATION_UNAVAILABLE"
  );
  assert.throws(() => validateTaskrabbitUrl("https://taskrabbit.com.evil.example/book"), (error: unknown) => error instanceof HomeFixError);
  await assert.rejects(
    () => adapter.createBookingLink("user-a", { taskTemplateId: "template-1" }),
    (error: unknown) => error instanceof HomeFixError && error.code === "INTEGRATION_UNAVAILABLE"
  );
});

test("adapter explains missing Composio tool execution permission", async () => {
  const tools: ComposioSession["tools"] = [
    { name: "TASKRABBIT_MCP_LIST_SUPPORTED_SERVICES", inputSchema: { type: "object", properties: { postalCode: { type: "string" } } } },
  ];
  const client = {
    callTool: async () => {
      throw Object.assign(new Error("Error executing the tool"), {
        cause: { status: 403, error: { slug: "APIKey_InsufficientPermissions", message: "This API key does not have tool_execution write access" } },
      });
    },
  } as unknown as ComposioSession["client"];
  const adapter = new ComposioTaskrabbitAdapter({ sessionFactory: async () => ({ client, tools }) });
  await assert.rejects(
    () => adapter.listSupportedServices("user-a", { postalCode: "10001" }),
    (error: unknown) => error instanceof HomeFixError
      && error.message.includes("Session tool execution write access")
      && error.nextAction === "grant_composio_session_execution_permissions"
  );
});

test("adapter explains that a Composio consumer key cannot create a Tool Router session", async () => {
  const adapter = new ComposioTaskrabbitAdapter({ apiKey: "ck_consumer_key" });
  const status = await adapter.getStatus("user-a");
  assert.equal(status.status, "error");
  assert.match(status.reason ?? "", /consumer key/);
});
