import { withService } from "./db";
import { env } from "./env";

/**
 * Error monitoring. Always records to error_events (visible in the admin dashboard);
 * also forwards to Sentry via its store API when SENTRY_DSN is configured.
 */
export async function captureError(err: unknown, context: Record<string, unknown> = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error("[clientwrap]", e.message, context);
  try {
    await withService((q) =>
      q.exec("insert into error_events (message, stack, context) values ($1,$2,$3)", [
        e.message.slice(0, 2000),
        e.stack?.slice(0, 8000) ?? null,
        JSON.stringify(context),
      ]),
    );
  } catch {
    /* never throw from the error reporter */
  }
  const dsn = env.SENTRY_DSN;
  if (dsn) {
    try {
      const u = new URL(dsn);
      const projectId = u.pathname.replace(/\//g, "");
      await fetch(`${u.protocol}//${u.host}/api/${projectId}/store/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${u.username}, sentry_client=clientwrap/1.0`,
        },
        body: JSON.stringify({
          message: e.message,
          level: "error",
          platform: "node",
          environment: env.NODE_ENV,
          extra: { ...context, stack: e.stack },
        }),
      });
    } catch {
      /* ignore */
    }
  }
}
