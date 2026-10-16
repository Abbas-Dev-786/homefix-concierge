import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import process from "node:process";
import fs from "node:fs";
import {
  Client,
  LATEST_PROTOCOL_VERSION,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const projectRoot = new URL("..", import.meta.url);

function loadLocalEnv() {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || line.trimStart().startsWith("#")) continue;
    const [, name, rawValue] = match;
    if (name === "PHASE1_TEST_ACCESS_TOKEN") continue;
    if (process.env[name] !== undefined) continue;
    process.env[name] = rawValue.trim().replace(/^"(.*)"$/, "$1");
  }
}

loadLocalEnv();

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate a local port"));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited before health check: ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // The listener is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for the MCP server health endpoint");
}

const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/mcp-use/dist/bin.js", import.meta.url)),
    "start",
    "--port",
    String(port),
    "--host",
    "127.0.0.1",
  ],
  { cwd: fileURLToPath(projectRoot), stdio: ["ignore", "pipe", "pipe"] }
);

let childOutput = "";
child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

const client = new Client({ name: "homefix-phase-1-protocol-check", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));

try {
  await waitForHealth(baseUrl, child);
  await client.connect(transport);
  const tools = await client.listTools();
  const probe = await client.callTool({ name: "compatibility-probe", arguments: { label: "protocol script" } });
  const negotiated = transport.protocolVersion;
  const probeTool = tools.tools.find((tool) => tool.name === "compatibility-probe");
  if (!negotiated || negotiated < LATEST_PROTOCOL_VERSION) {
    throw new Error(`Negotiated protocol ${negotiated ?? "unknown"}; required ${LATEST_PROTOCOL_VERSION} or later`);
  }
  if (!probeTool) {
    throw new Error("compatibility-probe was not returned by tools/list");
  }
  if (!probeTool.outputSchema) {
    throw new Error("compatibility-probe did not advertise outputSchema");
  }
  if (!probeTool._meta?.ui?.resourceUri && !probeTool._meta?.["ui/resourceUri"]) {
    throw new Error("compatibility-probe did not advertise an MCP App View resource");
  }
  if (probe.isError || !probe.structuredContent) {
    throw new Error("compatibility-probe did not return structuredContent");
  }

  const identityTool = tools.tools.find((tool) => tool.name === "verify-identity");
  let unauthenticatedProtectedTool = "not-configured";
  let authenticatedIdentity = "not-run";
  if (identityTool) {
    let unauthenticatedResult;
    try {
      unauthenticatedResult = await client.callTool({
        name: "verify-identity",
        arguments: {},
      });
    } catch {
      unauthenticatedResult = { isError: true };
    }
    if (!unauthenticatedResult.isError) {
      throw new Error("verify-identity was callable without authentication");
    }
    unauthenticatedProtectedTool = "rejected";

    const accessToken = process.env.PHASE1_TEST_ACCESS_TOKEN?.trim();
    if (accessToken) {
      const authenticatedClient = new Client({
        name: "homefix-phase-1-auth-check",
        version: "0.1.0",
      });
      const authenticatedTransport = new StreamableHTTPClientTransport(
        new URL(`${baseUrl}/mcp`),
        { authProvider: { token: async () => accessToken } }
      );
      try {
        await authenticatedClient.connect(authenticatedTransport);
        const identity = await authenticatedClient.callTool({
          name: "verify-identity",
          arguments: {},
        });
        const identityData = identity.structuredContent;
        if (
          identity.isError ||
          !identityData ||
          typeof identityData.userId !== "string" ||
          identityData.source !== "verified-oauth"
        ) {
          throw new Error("Authenticated verify-identity did not return verified OAuth identity");
        }
        authenticatedIdentity = {
          source: identityData.source,
          userIdPresent: true,
        };
      } finally {
        await authenticatedClient.close().catch(() => {});
      }
    } else {
      authenticatedIdentity = "not-run-missing-PHASE1_TEST_ACCESS_TOKEN";
    }
  }

  const readiness = await fetch(`${baseUrl}/ready`);
  const readinessBody = await readiness.json();
  const consent = await fetch(`${baseUrl}/oauth/consent?authorization_id=phase1-check`);
  const consentBody = await consent.text();
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    if (consent.status !== 200 || !consentBody.includes("approveAuthorization")) {
      throw new Error("Configured OAuth consent route did not return the approval page");
    }
  } else if (consent.status !== 503) {
    throw new Error(`Unconfigured OAuth consent route returned HTTP ${consent.status}`);
  }

  console.log(JSON.stringify({
    status: "passed",
    transport: "streamable-http",
    negotiatedProtocolVersion: negotiated,
    requiredProtocolVersion: LATEST_PROTOCOL_VERSION,
    toolCount: tools.tools.length,
    viewResource: probeTool._meta?.ui?.resourceUri ?? probeTool._meta?.["ui/resourceUri"],
    readiness: { status: readiness.status, body: readinessBody },
    consent: { status: consent.status },
    unauthenticatedProtectedTool,
    authenticatedIdentity,
    probeStructuredContent: probe.structuredContent,
  }, null, 2));
} catch (error) {
  console.error(childOutput);
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
  child.kill();
}

