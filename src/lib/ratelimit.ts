import { withService } from "./db";

/**
 * Fixed-window rate limiter backed by Postgres so it works across serverless instances.
 * Returns true if the request is allowed.
 */
export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  return withService(async (q) => {
    const row = await q.one<{ count: number }>(
      `insert into rate_limits (key, window_start, count) values ($1, $2, 1)
       on conflict (key, window_start) do update set count = rate_limits.count + 1
       returning count`,
      [key, windowStart],
    );
    return row.count <= max;
  });
}

export class RateLimitError extends Error {
  constructor(message = "Too many attempts. Please wait a few minutes and try again.") {
    super(message);
  }
}
