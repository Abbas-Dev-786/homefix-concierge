const sensitiveKeyPattern = /(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|passcode|secret|cookie|cvv|credit[-_ ]?card|ssn|social[-_ ]?security)/i;
const sensitiveValuePattern = /\b(?:Bearer\s+|ak_|ck_|uak_|sk-)[A-Za-z0-9._-]+/i;

/**
 * Keep persisted activity data useful while preventing accidental secret and
 * transcript growth. This is deliberately conservative because event data is
 * later rendered by the View and included in user exports.
 */
export function sanitizePersistedData(value: unknown, key = "", depth = 0): unknown {
  if (depth > 5) return "[TRUNCATED]";
  if (sensitiveKeyPattern.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (sensitiveValuePattern.test(value)) return "[REDACTED]";
    return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizePersistedData(item, key, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([childKey, childValue]) => [childKey, sanitizePersistedData(childValue, childKey, depth + 1)])
    );
  }
  return "[UNSUPPORTED]";
}
