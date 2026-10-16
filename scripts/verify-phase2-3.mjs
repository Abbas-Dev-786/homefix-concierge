import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import fs from "node:fs";
import process from "node:process";

function loadLocalEnv() {
  if (!fs.existsSync(".env")) return;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || line.trimStart().startsWith("#")) continue;
    const [, name, rawValue] = match;
    if (process.env[name] !== undefined) continue;
    process.env[name] = rawValue.trim().replace(/^"(.*)"$/, "$1");
  }
}

function requireHttpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("MCP_URL must use HTTPS for the Phase 2/3 deployed check");
  return url;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function connect(endpoint, token, name) {
  const client = new Client({ name, version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(endpoint, { authProvider: { token: async () => token } });
  await client.connect(transport);
  return client;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    const message = result.content?.find((item) => item.type === "text")?.text ?? `${name} failed`;
    throw new Error(message);
  }
  return result.structuredContent;
}

loadLocalEnv();
const endpoint = requireHttpsUrl(process.env.MCP_URL ?? "");
const tokenA = process.env.PHASE23_TEST_ACCESS_TOKEN_A?.trim();
const tokenB = process.env.PHASE23_TEST_ACCESS_TOKEN_B?.trim();
if (!tokenA || !tokenB) {
  throw new Error("Set PHASE23_TEST_ACCESS_TOKEN_A and PHASE23_TEST_ACCESS_TOKEN_B to dedicated Supabase test-user tokens");
}

const clientA = await connect(endpoint, tokenA, "homefix-phase-2-3-user-a");
const clientB = await connect(endpoint, tokenB, "homefix-phase-2-3-user-b");
const testKey = `phase23-${Date.now()}`;

try {
  const identityA = await call(clientA, "verify-identity");
  const identityB = await call(clientB, "verify-identity");
  assert(identityA.userId && identityB.userId && identityA.userId !== identityB.userId, "The two test tokens must belong to different users");

  const beforeB = await call(clientB, "open_homefix_dashboard");
  assert(beforeB.onboardingRequired === true && beforeB.openRequests.length === 0, "User B should start without a household");

  const householdA1 = await call(clientA, "create_household");
  const householdA2 = await call(clientA, "create_household");
  assert(householdA1.householdId === householdA2.householdId, "Repeated household creation returned different households");

  await call(clientA, "save_home_profile", {
    city: "Phase 2 test market",
    countryCode: "US",
    currencyCode: "USD",
    preferredServiceWindows: ["Saturday morning"],
    typicalBudgetAmount: 250,
  });
  const contextA = await call(clientA, "get_home_context");
  assert(contextA.profile?.city === "Phase 2 test market", "Saved profile was not returned for user A");

  const group = await call(clientA, "create_repair_group", { groupBudgetMax: 250, currencyCode: "USD" });
  const requestArgs = {
    title: "Phase 2/3 verification repair",
    description: "Temporary isolated verification record",
    urgency: "routine",
    intakeGroupId: group.id,
    idempotencyKey: testKey,
  };
  const requestA1 = await call(clientA, "create_repair_request", requestArgs);
  const requestA2 = await call(clientA, "create_repair_request", requestArgs);
  assert(requestA1.id === requestA2.id, "Repeated repair creation duplicated the request");

  const listA = await call(clientA, "list_maintenance_requests", { openOnly: true });
  assert(listA.requests.some((request) => request.id === requestA1.id), "User A cannot read the persisted request");
  const forbiddenUpdate = await clientB.callTool({
    name: "update_maintenance_status",
    arguments: { requestId: requestA1.id, status: "searching" },
  });
  assert(forbiddenUpdate.isError === true, "User B could mutate User A's request");

  await call(clientA, "update_maintenance_status", { requestId: requestA1.id, status: "searching" });
  const afterReconnect = await connect(endpoint, tokenA, "homefix-phase-2-3-reconnect");
  try {
    const persisted = await call(afterReconnect, "list_maintenance_requests", { openOnly: true });
    const saved = persisted.requests.find((request) => request.id === requestA1.id);
    assert(saved?.status === "searching", "Request state did not survive a new MCP session");
  } finally {
    await afterReconnect.close().catch(() => {});
  }

  const providerStatus = await call(clientA, "get_taskrabbit_status");
  assert(providerStatus.status === "unavailable", "Phase 3 provider status must remain explicit until Phase 4");

  console.log(JSON.stringify({
    status: "passed",
    checks: {
      twoUserIdentityIsolation: true,
      householdIdempotency: true,
      profilePersistence: true,
      repairIdempotency: true,
      crossUserMutationRejected: true,
      statePersistenceAcrossSession: true,
      providerUnavailableWithoutPhase4Adapter: true,
    },
    testRequestId: requestA1.id,
  }, null, 2));
} finally {
  await clientA.close().catch(() => {});
  await clientB.close().catch(() => {});
}
