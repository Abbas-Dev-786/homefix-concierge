export const MAX_REQUEST_BYTES = 256 * 1024;

export class SlidingWindowRateLimiter {
  private readonly requests = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs = 60_000) {}

  allow(key: string, now = Date.now()) {
    const active = (this.requests.get(key) ?? []).filter((timestamp) => now - timestamp < this.windowMs);
    if (active.length >= this.limit) {
      this.requests.set(key, active);
      return false;
    }
    active.push(now);
    this.requests.set(key, active);
    return true;
  }
}

export function clientAddress(headers: { get(name: string): string | null }) {
  return headers.get("cf-connecting-ip")
    ?? headers.get("x-real-ip")
    ?? headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    ?? "unknown";
}
