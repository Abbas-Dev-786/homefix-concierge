import { z } from "zod";

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MCP_ENDPOINT_PATH: z.string().trim().min(1).default("/mcp"),
  MCP_URL: optionalTrimmedString,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  COMPOSIO_API_KEY: optionalTrimmedString,
  TASKRABBIT_TOOL_MAP_JSON: optionalTrimmedString,
  SUPABASE_URL: optionalTrimmedString,
  SUPABASE_ANON_KEY: optionalTrimmedString,
  SUPABASE_SERVICE_ROLE_KEY: optionalTrimmedString,
  MCP_USE_OAUTH_SUPABASE_PROJECT_ID: optionalTrimmedString,
  MCP_USE_OAUTH_SUPABASE_JWT_SECRET: optionalTrimmedString,
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  OUTBOUND_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
});

for (const name of [
  "MCP_URL",
  "COMPOSIO_API_KEY",
  "TASKRABBIT_TOOL_MAP_JSON",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MCP_USE_OAUTH_SUPABASE_PROJECT_ID",
  "MCP_USE_OAUTH_SUPABASE_JWT_SECRET",
]) {
  if (process.env[name]?.trim() === "") delete process.env[name];
}

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const details = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parsedEnvironment.data;

export const oauthConfigured = Boolean(
  env.SUPABASE_URL || env.MCP_USE_OAUTH_SUPABASE_PROJECT_ID
);

export const supabaseConfigured = Boolean(
  env.SUPABASE_URL && env.SUPABASE_ANON_KEY
);

export const composioConfigured = Boolean(env.COMPOSIO_API_KEY);

export const persistenceConfigured = Boolean(
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
);

