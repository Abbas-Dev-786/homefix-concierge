import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import process from "node:process";
import { spawn } from "node:child_process";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Load .env before running this script.`);
  return value;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function randomString(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

async function jsonResponse(response, label) {
  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { raw: body.slice(0, 500) };
  }
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}: ${JSON.stringify(parsed)}`);
  return parsed;
}

async function loadLocalEnv() {
  try {
    const contents = await fs.readFile(".env", "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || line.trimStart().startsWith("#")) continue;
      if (process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].trim().replace(/^"(.*)"$/, "$1");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function openBrowser(url) {
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [url], { detached: true, stdio: "ignore" }).unref();
}

function waitForCallback(redirectUri, expectedState, timeoutMs = 5 * 60 * 1000) {
  const callbackUrl = new URL(redirectUri);
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", redirectUri);
      if (url.pathname !== callbackUrl.pathname) {
        response.writeHead(404).end("Not found");
        return;
      }
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");
      if (returnedState !== expectedState) {
        response.writeHead(400).end("OAuth state mismatch. You can close this tab.");
        server.close();
        reject(new Error("OAuth state mismatch"));
        return;
      }
      if (error) {
        response.writeHead(400).end("OAuth authorization was denied. You can close this tab.");
        server.close();
        reject(new Error(`OAuth authorization failed: ${error}${errorDescription ? ` — ${errorDescription}` : ""}`));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        response.writeHead(400).end("OAuth callback did not contain a code. You can close this tab.");
        server.close();
        reject(new Error("OAuth callback did not contain an authorization code"));
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<p>Authorization complete. You can close this tab.</p>");
      server.close();
      resolve(code);
    });
    server.on("error", reject);
    server.listen(Number(callbackUrl.port), callbackUrl.hostname);
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for the OAuth callback"));
    }, timeoutMs);
    server.once("close", () => clearTimeout(timer));
  });
}

await loadLocalEnv();
const mcpUrl = required("MCP_URL");
const mcpEndpoint = new URL(mcpUrl);
const metadataUrl = new URL("/.well-known/oauth-authorization-server", mcpEndpoint.origin);
const metadata = await jsonResponse(await fetch(metadataUrl), "OAuth metadata discovery");
const redirectPort = Number(process.env.OAUTH_REDIRECT_PORT ?? "8765");
if (!Number.isInteger(redirectPort) || redirectPort < 1024 || redirectPort > 65535) {
  throw new Error("OAUTH_REDIRECT_PORT must be an integer between 1024 and 65535");
}
const outputPath = process.env.OAUTH_TOKEN_FILE?.trim() || ".oauth-token.env";

if (process.argv.includes("--refresh")) {
  let existingContent = "";
  try {
    existingContent = await fs.readFile(outputPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const refreshToken = existingContent.match(/^PHASE1_REFRESH_TOKEN=(.+)$/m)?.[1]?.trim() || process.env.PHASE1_REFRESH_TOKEN?.trim();
  const accessToken = existingContent.match(/^PHASE1_TEST_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim() || process.env.PHASE1_TEST_ACCESS_TOKEN?.trim();

  if (!refreshToken) {
    throw new Error(`Cannot refresh: No PHASE1_REFRESH_TOKEN found in ${outputPath} or environment.`);
  }

  let clientId;
  if (accessToken) {
    try {
      const parts = accessToken.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        clientId = payload.client_id;
      }
    } catch {}
  }
  if (!clientId) {
    throw new Error("Cannot refresh: Could not determine client_id from existing access token.");
  }

  console.log("Refreshing OAuth token using refresh token...");
  const tokens = await jsonResponse(await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  }), "OAuth token refresh");

  if (!tokens.access_token) throw new Error("OAuth token refresh did not return access_token");
  await fs.writeFile(outputPath, `PHASE1_TEST_ACCESS_TOKEN=${tokens.access_token}\n${tokens.refresh_token ? `PHASE1_REFRESH_TOKEN=${tokens.refresh_token}\n` : ""}`, { encoding: "utf8", mode: 0o600 });
  const expiresAt = typeof tokens.expires_in === "number" ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : "unknown";
  console.log(`OAuth token refreshed and saved to ${outputPath}.`);
  console.log(`Access-token expiry: ${expiresAt}`);
  console.log("Load it in PowerShell with:");
  console.log(`$env:PHASE1_TEST_ACCESS_TOKEN = (Get-Content '${outputPath}' | Select-String '^PHASE1_TEST_ACCESS_TOKEN=').Line.Split('=', 2)[1]`);
  process.exit(0);
}

const redirectUri = `http://127.0.0.1:${redirectPort}/callback`;
const verifier = randomString(48);
const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
const state = randomString(32);

const registration = await jsonResponse(await fetch(metadata.registration_endpoint, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({
    client_name: "HomeFix local OAuth token helper",
    redirect_uris: [redirectUri],
    application_type: "native",
    response_types: ["code"],
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "none",
    code_challenge_methods: ["S256"],
  }),
}), "OAuth client registration");

if (!registration.client_id) throw new Error("OAuth registration did not return client_id");
const authorizeUrl = new URL(metadata.authorization_endpoint);
authorizeUrl.search = new URLSearchParams({
  response_type: "code",
  client_id: registration.client_id,
  redirect_uri: redirectUri,
  scope: "openid email profile",
  state,
  code_challenge: challenge,
  code_challenge_method: "S256",
  resource: mcpEndpoint.toString(),
}).toString();

console.log("Opening the Supabase OAuth authorization page...");
console.log(`If it does not open automatically, visit: ${authorizeUrl}`);
openBrowser(authorizeUrl.toString());
const code = await waitForCallback(redirectUri, state);

const tokenBody = new URLSearchParams({
  grant_type: "authorization_code",
  code,
  client_id: registration.client_id,
  redirect_uri: redirectUri,
  code_verifier: verifier,
  resource: mcpEndpoint.toString(),
});
const tokens = await jsonResponse(await fetch(metadata.token_endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
  body: tokenBody,
}), "OAuth token exchange");

if (!tokens.access_token) throw new Error("OAuth token exchange did not return access_token");
await fs.writeFile(outputPath, `PHASE1_TEST_ACCESS_TOKEN=${tokens.access_token}\n${tokens.refresh_token ? `PHASE1_REFRESH_TOKEN=${tokens.refresh_token}\n` : ""}`, { encoding: "utf8", mode: 0o600 });
const expiresAt = typeof tokens.expires_in === "number" ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : "unknown";
console.log(`OAuth token saved to ${outputPath}.`);
console.log(`Access-token expiry: ${expiresAt}`);
console.log("Load it in PowerShell with:");
console.log(`$env:PHASE1_TEST_ACCESS_TOKEN = (Get-Content '${outputPath}' | Select-String '^PHASE1_TEST_ACCESS_TOKEN=').Line.Split('=', 2)[1]`);
