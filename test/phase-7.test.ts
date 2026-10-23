import assert from "node:assert/strict";
import test from "node:test";

import { sanitizePersistedData } from "../src/security/sanitization.js";
import { SlidingWindowRateLimiter, clientAddress } from "../src/security/request-limits.js";
import { clarificationQuestion, missingRequiredServiceSearchInputs } from "../src/domain/service-search-inputs.js";
import { getCurrentDateTime, isValidTimeZone } from "../src/domain/current-date-time.js";
import { registerHomeFixTools } from "../src/tools/homefix-tools.js";

test("current date-time tool formats a fresh instant for the requested timezone", () => {
  const current = getCurrentDateTime(new Date("2026-10-23T12:34:56.000Z"), "Asia/Kolkata");
  assert.equal(current.date, "2026-10-23");
  assert.equal(current.time, "18:04:56");
  assert.equal(current.dateTime, "2026-10-23T18:04:56+05:30");
  assert.equal(current.timeZone, "Asia/Calcutta");
  assert.equal(current.utcOffset, "+05:30");
  assert.equal(current.unixMilliseconds, 1792758896000);
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("not/a-timezone"), false);
});

test("persisted event data redacts secrets and bounds large values", () => {
  const value = sanitizePersistedData({ authorization: "Bearer super-secret", note: "x".repeat(3000) });
  assert.deepEqual(value, { authorization: "[REDACTED]", note: `${"x".repeat(2000)}…` });
});

test("rate limiter enforces a per-key sliding window", () => {
  const limiter = new SlidingWindowRateLimiter(2, 1000);
  assert.equal(limiter.allow("user-a", 0), true);
  assert.equal(limiter.allow("user-a", 1), true);
  assert.equal(limiter.allow("user-a", 2), false);
  assert.equal(limiter.allow("user-b", 2), true);
  assert.equal(limiter.allow("user-a", 1001), true);
});

test("client address prefers trusted proxy headers and has a safe fallback", () => {
  const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });
  assert.equal(clientAddress(headers({ "cf-connecting-ip": "203.0.113.10", "x-forwarded-for": "198.51.100.4" })), "203.0.113.10");
  assert.equal(clientAddress(headers({ "x-forwarded-for": "198.51.100.4, 198.51.100.5" })), "198.51.100.4");
  assert.equal(clientAddress(headers({})), "unknown");
});

test("service search preflight identifies missing user-owned inputs", () => {
  const missing = missingRequiredServiceSearchInputs({ serviceCategory: "plumbing", city: "Austin", region: "TX" });
  assert.deepEqual(missing, ["desiredDate", "desiredTimeWindow"]);
  assert.match(clarificationQuestion(missing), /date/);
  assert.match(clarificationQuestion(missing), /time window/);
  assert.deepEqual(missingRequiredServiceSearchInputs({ postalCode: "not-a-postal-code", desiredDate: "2026-10-24", desiredTimeWindow: "morning" }), ["serviceCategory", "location"]);
});

test("find_service_options asks for missing timing before changing state or calling Taskrabbit", async () => {
  const handlers: Record<string, (input: unknown, context: unknown) => Promise<any>> = {};
  const fakeServer = {
    tool(definition: { name: string }, handler: (input: unknown, context: unknown) => Promise<any>) {
      handlers[definition.name] = handler;
      return definition.name;
    },
  };
  let statusUpdates = 0;
  let providerCalls = 0;
  const scope = { householdId: "household-a", displayName: "A", role: "owner" };
  const repository = {
    resolveHousehold: async () => scope,
    getRequest: async () => ({
      id: "request-a",
      title: "Leaking tap",
      description: "Kitchen tap is leaking",
      serviceCategory: "plumbing",
      desiredDate: null,
      desiredTimeWindow: null,
    }),
    getProfile: async () => ({ city: "Austin", region: "TX", postalCode: null }),
    updateRequestStatus: async () => { statusUpdates += 1; },
  };
  const adapter = { checkAvailability: async () => { providerCalls += 1; throw new Error("must not call"); } };
  registerHomeFixTools(fakeServer as never, repository as never, adapter as never);

  const result = await handlers.find_service_options(
    { requestId: "request-a" },
    { auth: { user: { id: "user-a" } } },
  );
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.status, "needs_user_input");
  assert.deepEqual(result.structuredContent.missingFields, ["desiredDate", "desiredTimeWindow"]);
  assert.equal(result.structuredContent.nextAction, "ask_user");
  assert.match(result.content[0].text, /ask the user/i);
  assert.equal(statusUpdates, 0);
  assert.equal(providerCalls, 0);
});

test("find_service_options describes a handoff option when Taskrabbit returns no exact slots", async () => {
  const handlers: Record<string, (input: unknown, context: unknown) => Promise<any>> = {};
  const fakeServer = {
    tool(definition: { name: string }, handler: (input: unknown, context: unknown) => Promise<any>) {
      handlers[definition.name] = handler;
      return definition.name;
    },
  };
  const scope = { householdId: "household-a", displayName: "A", role: "owner" };
  const repository = {
    resolveHousehold: async () => scope,
    getRequest: async () => ({ id: "request-a", title: "Main hall AC", description: "AC is not working", serviceCategory: "AC/HVAC repair", desiredDate: "2026-10-24", desiredTimeWindow: "10:00 AM-12:00 PM" }),
    getProfile: async () => ({ city: "New York", region: "NY", postalCode: "10001" }),
    updateRequestStatus: async () => undefined,
    createServiceSearch: async () => ({ id: "search-a", status: "completed", resultCount: 1, retrievedAt: "2026-10-23T00:00:00.000Z", source: "supabase" }),
    createServiceOptions: async (_scope: unknown, options: any[]) => options.map((option) => ({ id: "option-a", searchId: "search-a", requestId: "request-a", ...option, source: "live_taskrabbit" })),
  };
  const adapter = {
    checkAvailability: async () => ({
      options: [{
        title: "Appliance Installation & Repairs",
        providerName: null,
        serviceCategory: "AC/HVAC repair",
        locationLabel: "New York, NY, 10001",
        estimateMin: 33.33,
        estimateMax: 155.55,
        priceLabel: "Average rate",
        currencyCode: "USD",
        availabilitySummary: "Available",
        availabilitySlots: [],
        scopingQuestions: [],
        taskTemplateId: "appliance_installation_repairs",
        bookingContext: { categoryId: "appliance_installation_repairs", locale: "en-US", questionnaire: [] },
      }],
      retrievedAt: "2026-10-23T00:00:00.000Z",
      expiresAt: "2026-10-23T00:15:00.000Z",
      source: "live_taskrabbit" as const,
    }),
  };
  registerHomeFixTools(fakeServer as never, repository as never, adapter as never);

  const result = await handlers.find_service_options(
    { requestId: "request-a" },
    { auth: { user: { id: "user-a" } }, signal: new AbortController().signal },
  );
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.status, "available");
  assert.equal(result.structuredContent.nextAction, "select_option");
  assert.match(result.structuredContent.message, /select an option/i);
  assert.deepEqual(result.structuredContent.options[0].availabilitySlots, []);
});

test("list_supported_services asks for location before calling Taskrabbit", async () => {
  const handlers: Record<string, (input: unknown, context: unknown) => Promise<any>> = {};
  const fakeServer = {
    tool(definition: { name: string }, handler: (input: unknown, context: unknown) => Promise<any>) {
      handlers[definition.name] = handler;
      return definition.name;
    },
  };
  let providerCalls = 0;
  const repository = {
    resolveHousehold: async () => ({ householdId: "household-a", displayName: "A", role: "owner" }),
    getProfile: async () => ({ city: null, region: null, postalCode: null }),
  };
  const adapter = { listSupportedServices: async () => { providerCalls += 1; throw new Error("must not call"); } };
  registerHomeFixTools(fakeServer as never, repository as never, adapter as never);

  const result = await handlers.list_supported_services({}, { auth: { user: { id: "user-a" } } });
  assert.equal(result.structuredContent.status, "needs_user_input");
  assert.deepEqual(result.structuredContent.missingFields, ["location"]);
  assert.equal(providerCalls, 0);
});

test("stale handoff refresh asks for missing timing before calling availability", async () => {
  const handlers: Record<string, (input: unknown, context: unknown) => Promise<any>> = {};
  const fakeServer = {
    tool(definition: { name: string }, handler: (input: unknown, context: unknown) => Promise<any>) {
      handlers[definition.name] = handler;
      return definition.name;
    },
  };
  let providerCalls = 0;
  const repository = {
    resolveHousehold: async () => ({ householdId: "household-a", displayName: "A", role: "owner" }),
    existingBookingHandoff: async () => null,
    listOptions: async () => [{ id: "option-a", retrievedAt: "2026-10-20T00:00:00.000Z", taskTemplateId: "plumbing" }],
    latestSearch: async () => ({ search_criteria: { serviceCategory: "plumbing", city: "Austin", region: "TX" }, location_snapshot: { city: "Austin", region: "TX" } }),
    getRequest: async () => ({ title: "Leaking tap", description: "Kitchen tap is leaking", serviceCategory: "plumbing", desiredDate: null, desiredTimeWindow: null }),
    getProfile: async () => ({ city: "Austin", region: "TX", postalCode: null }),
  };
  const adapter = { checkAvailability: async () => { providerCalls += 1; throw new Error("must not call"); } };
  registerHomeFixTools(fakeServer as never, repository as never, adapter as never);

  const result = await handlers.create_booking_handoff(
    { requestId: "request-a", serviceOptionId: "option-a", idempotencyKey: "handoff-key-1" },
    { auth: { user: { id: "user-a" } } },
  );
  assert.equal(result.structuredContent.status, "needs_user_input");
  assert.deepEqual(result.structuredContent.missingFields, ["desiredDate", "desiredTimeWindow"]);
  assert.equal(providerCalls, 0);
});

test("create_booking_handoff exposes the validated URL in model-visible content", async () => {
  const handlers: Record<string, (input: unknown, context: unknown) => Promise<any>> = {};
  const fakeServer = {
    tool(definition: { name: string }, handler: (input: unknown, context: unknown) => Promise<any>) {
      handlers[definition.name] = handler;
      return definition.name;
    },
  };
  const bookingUrl = "https://www.taskrabbit.com/book/6919/details?job_draft_guid=test";
  const repository = {
    resolveHousehold: async () => ({ householdId: "household-a", displayName: "A", role: "owner" }),
    existingBookingHandoff: async () => null,
    listOptions: async () => [{
      id: "option-a",
      retrievedAt: new Date().toISOString(),
      taskTemplateId: "appliance_installation_repairs",
      bookingContext: { categoryId: "appliance_installation_repairs", locale: "en-US", questionnaire: [] },
    }],
    createBookingHandoff: async () => ({ id: "handoff-a", status: "ready", bookingUrl, retrievedAt: new Date().toISOString(), source: "supabase" }),
  };
  const adapter = { createBookingLink: async () => ({ bookingUrl, retrievedAt: new Date().toISOString(), source: "live_taskrabbit" as const }) };
  registerHomeFixTools(fakeServer as never, repository as never, adapter as never);

  const result = await handlers.create_booking_handoff(
    { requestId: "request-a", serviceOptionId: "option-a", idempotencyKey: "handoff-key-2" },
    { auth: { user: { id: "user-a" } } },
  );
  assert.equal(result.structuredContent.bookingUrl, bookingUrl);
  assert.match(result.content[0].text, new RegExp(bookingUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.content[0].text, /choose a Tasker and complete the booking/i);
});
