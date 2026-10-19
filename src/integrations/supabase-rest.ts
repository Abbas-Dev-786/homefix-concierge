import { HomeFixError } from "../domain/errors.js";

type JsonObject = Record<string, unknown>;

export class SupabaseRestClient {
  private readonly baseUrl: string;

  constructor(
    private readonly supabaseUrl: string,
    private readonly serviceRoleKey: string,
    private readonly timeoutMs = 12000
  ) {
    this.baseUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1`;
  }

  private async request<T>(
    path: string,
    options: { method?: string; query?: Record<string, string>; body?: unknown; prefer?: string } = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          Accept: "application/json",
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(options.prefer ? { Prefer: options.prefer } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new HomeFixError(
        "PERSISTENCE_UNAVAILABLE",
        "Saved HomeFix data is temporarily unavailable. Please retry.",
        true,
        "retry_persistence"
      );
    }

    const text = await response.text();
    if (!response.ok) {
      throw new HomeFixError(
        response.status === 409 ? "CONFLICT" : "PERSISTENCE_UNAVAILABLE",
        response.status === 409
          ? "That HomeFix record already exists. Refresh and try again."
          : "Saved HomeFix data is temporarily unavailable. Please retry.",
        response.status >= 500,
        response.status === 409 ? "refresh_and_retry" : "retry_persistence"
      );
    }

    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HomeFixError(
        "PERSISTENCE_UNAVAILABLE",
        "Saved HomeFix data returned an invalid response. Please retry.",
        true,
        "retry_persistence"
      );
    }
  }

  select<T>(table: string, query: Record<string, string>) {
    return this.request<T[]>(table, { query: { select: "*", ...query } });
  }

  insert<T>(table: string, row: JsonObject) {
    return this.request<T[]>(table, {
      method: "POST",
      body: row,
      prefer: "return=representation",
    });
  }

  upsert<T>(table: string, row: JsonObject, conflictColumn: string) {
    return this.request<T[]>(table, {
      method: "POST",
      query: { on_conflict: conflictColumn },
      body: row,
      prefer: "return=representation,resolution=merge-duplicates",
    });
  }

  update<T>(table: string, query: Record<string, string>, row: JsonObject) {
    return this.request<T[]>(table, {
      method: "PATCH",
      query,
      body: row,
      prefer: "return=representation",
    });
  }

  delete<T>(table: string, query: Record<string, string>) {
    return this.request<T[]>(table, {
      method: "DELETE",
      query,
      prefer: "return=representation",
    });
  }

  rpc<T>(functionName: string, body: JsonObject) {
    return this.request<T[]>(`rpc/${functionName}`, {
      method: "POST",
      body,
      prefer: "return=representation",
    });
  }
}
