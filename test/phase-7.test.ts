import assert from "node:assert/strict";
import test from "node:test";

import { sanitizePersistedData } from "../src/security/sanitization.js";
import { SlidingWindowRateLimiter, clientAddress } from "../src/security/request-limits.js";

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
