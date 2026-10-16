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

test("adapter explains that a Composio consumer key cannot create a Tool Router session", async () => {
  const adapter = new ComposioTaskrabbitAdapter({ apiKey: "ck_consumer_key" });
  const status = await adapter.getStatus("user-a");
  assert.equal(status.status, "error");
  assert.match(status.reason ?? "", /consumer key/);
});
