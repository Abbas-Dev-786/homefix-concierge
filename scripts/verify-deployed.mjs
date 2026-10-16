import { Client, LATEST_PROTOCOL_VERSION, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import fs from "node:fs";
import process from "node:process";

function loadLocalEnv() {
  if (!fs.existsSync(".env")) return;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || line.trimStart().startsWith("#")) continue;
    const [, name, rawValue] = match;
    if (name === "PHASE1_TEST_ACCESS_TOKEN") continue;
    if (process.env[name] !== undefined) continue;
    const value = rawValue.trim().replace(/^"(.*)"$/, "$1");
    process.env[name] = value;
  }
}

function requireHttpsUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS for the deployed check`);
  }
  return url;
}

function rootUrlFor(endpoint) {
  const root = new URL(endpoint);
  root.pathname = root.pathname.replace(/\/mcp\/?$/, "/");
  root.search = "";
  root.hash = "";
  return root;
}

loadLocalEnv();

const endpoint = requireHttpsUrl(process.env.MCP_URL ?? "", "MCP_URL");
const root = rootUrlFor(endpoint);
const client = new Client({ name: "homefix-phase-1-deployed-check", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(endpoint);

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const probeTool = tools.tools.find((tool) => tool.name === "compatibility-probe");
  if (!probeTool?.outputSchema) throw new Error("Deployed compatibility-probe has no outputSchema");
  const viewResource = probeTool._meta?.ui?.resourceUri ?? probeTool._meta?.["ui/resourceUri"];
  if (!viewResource) throw new Error("Deployed compatibility-probe has no View resource binding");
  const probe = await client.callTool({ name: "compatibility-probe", arguments: { label: "deployed check" } });
  if (probe.isError || !probe.structuredContent) {
    throw new Error("Deployed compatibility-probe did not return structuredContent");
  }
  if (!transport.protocolVersion || transport.protocolVersion < LATEST_PROTOCOL_VERSION) {
    throw new Error(`Deployed protocol ${transport.protocolVersion ?? "unknown"}; required ${LATEST_PROTOCOL_VERSION} or later`);
  }

  const identityTool = tools.tools.find((tool) => tool.name === "verify-identity");
  let unauthenticatedProtectedTool = "not-configured";
  let authenticatedIdentity = "not-run-missing-PHASE1_TEST_ACCESS_TOKEN";
  if (identityTool) {
    let unauthenticatedResult;
    try {
      unauthenticatedResult = await client.callTool({ name: "verify-identity", arguments: {} });
    } catch {
      unauthenticatedResult = { isError: true };
    }
    if (!unauthenticatedResult.isError) {
      throw new Error("Deployed verify-identity was callable without authentication");
    }
    unauthenticatedProtectedTool = "rejected";

    const accessToken = process.env.PHASE1_TEST_ACCESS_TOKEN?.trim();
    if (accessToken) {
      const authenticatedClient = new Client({ name: "homefix-phase-1-deployed-auth-check", version: "0.1.0" });
      const authenticatedTransport = new StreamableHTTPClientTransport(endpoint, {
        authProvider: { token: async () => accessToken },
      });
      try {
        await authenticatedClient.connect(authenticatedTransport);
        const identity = await authenticatedClient.callTool({ name: "verify-identity", arguments: {} });
        const data = identity.structuredContent;
        if (identity.isError || !data || typeof data.userId !== "string" || data.source !== "verified-oauth") {
          throw new Error("Deployed verify-identity did not return a verified OAuth identity");
        }
        authenticatedIdentity = { source: data.source, userIdPresent: true };
      } finally {
        await authenticatedClient.close().catch(() => {});
      }
    }
  }

  const readiness = await fetch(new URL("ready", root));
  const consent = await fetch(new URL("oauth/consent?authorization_id=phase1-deployed-check", root));
  if (consent.status !== 200) throw new Error(`Deployed consent route returned HTTP ${consent.status}`);
  const consentBody = await consent.text();
  if (!consentBody.includes("approveAuthorization")) {
    throw new Error("Deployed consent route did not return the approval page");
  }

  console.log(JSON.stringify({
    status: "passed",
    endpoint: `${endpoint.origin}${endpoint.pathname}`,
    transport: "streamable-http",
    negotiatedProtocolVersion: transport.protocolVersion,
    requiredProtocolVersion: LATEST_PROTOCOL_VERSION,
    toolCount: tools.tools.length,
    viewResource,
    readiness: { status: readiness.status, body: await readiness.json() },
    consent: { status: consent.status },
    unauthenticatedProtectedTool,
    authenticatedIdentity,
    probeStructuredContent: probe.structuredContent,
  }, null, 2));
} finally {
  await client.close().catch(() => {});
}
