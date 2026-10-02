/**
 * Structured logging.
 *
 * `v2.0.1` installs a MongoDB `logging.Handler` on `logging.root` at ERROR
 * level, so every error from every library became a synchronous `insert_one`
 * into the `logs` collection. That handler has no queue, no flush timer and no
 * `atexit` hook (mongo.py:137-184), so it is a blocking write that can mask the
 * very failure it is recording — defect D27.
 *
 * Here logging goes to Cloudflare Workers Logs via `console`, which is free on
 * the Free plan, needs no index, and cannot block a request.
 */

type Level = "debug" | "info" | "warn" | "error";

const MIN_LEVEL: Level = (globalThis as { __LOG_LEVEL__?: Level }).__LOG_LEVEL__ ?? "info";

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  if (order[level] < order[MIN_LEVEL]) return;

  const payload = context ? { message, ...context } : { message };
  switch (level) {
    case "error":
      console.error(JSON.stringify(payload));
      break;
    case "warn":
      console.warn(JSON.stringify(payload));
      break;
    default:
      console.log(JSON.stringify(payload));
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),
};
