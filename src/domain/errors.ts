export type HomeFixErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "ONBOARDING_REQUIRED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE"
  | "PERSISTENCE_UNAVAILABLE"
  | "INTEGRATION_UNAVAILABLE"
  | "UNEXPECTED_ERROR";

export class HomeFixError extends Error {
  constructor(
    public readonly code: HomeFixErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly nextAction = "review_and_retry"
  ) {
    super(message);
    this.name = "HomeFixError";
  }
}

export function asHomeFixError(error: unknown): HomeFixError {
  if (error instanceof HomeFixError) return error;
  return new HomeFixError(
    "UNEXPECTED_ERROR",
    "HomeFix could not complete that operation.",
    true,
    "retry_or_contact_support"
  );
}

export function errorResult(error: unknown) {
  const normalized = asHomeFixError(error);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: normalized.message }],
    structuredContent: {
      ok: false as const,
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
      nextAction: normalized.nextAction,
    },
  };
}
