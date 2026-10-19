import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".mcp-use/build/views");
const files = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else files.push(fullPath);
  }
}

walk(root);
if (!files.length) throw new Error("No built View assets found; run the production build first.");

const forbidden = [
  /SUPABASE_SERVICE_ROLE_KEY/,
  /COMPOSIO_API_KEY/,
  /MCP_USE_OAUTH_SUPABASE_JWT_SECRET/,
  /\b(?:ak_|ck_|uak_)[A-Za-z0-9._-]{12,}/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./,
];

const findings = [];
for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(content)) findings.push(`${path.relative(process.cwd(), file)} matches ${pattern}`);
  }
}

if (findings.length) {
  throw new Error(`Potential secret leakage in built View assets:\n${findings.join("\n")}`);
}

console.log(JSON.stringify({ status: "passed", scannedFiles: files.length, scope: "built-view-assets" }, null, 2));
