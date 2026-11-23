/**
 * A small fixed-window rate limiter, in process memory.
 *
 * Deliberately simple: the CMS runs as ONE process (Strapi's admin and cron
 * assume it), so an in-memory counter is accurate. If the CMS is ever scaled
 * horizontally this becomes per-instance — still a useful brake, but the
 * limits would need to move to the database or a shared store.
 *
 * The key is the visitor IP forwarded by the storefront (the CMS is never
 * called by browsers directly) plus the action.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

export const LIMITS: Record<string, { max: number; windowMs: number }> = {
  quote: { max: 120, windowMs: 60_000 },
  checkout: { max: 10, windowMs: 10 * 60_000 },
  lookup: { max: 20, windowMs: 10 * 60_000 },
  review: { max: 5, windowMs: 60 * 60_000 },
  report: { max: 10, windowMs: 60 * 60_000 },
  sourcing: { max: 5, windowMs: 60 * 60_000 },
  build: { max: 5, windowMs: 60 * 60_000 },
};

export function hit(action: string, key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  const limit = LIMITS[action] ?? { max: 30, windowMs: 60_000 };
  const id = `${action}:${key}`;
  let window = windows.get(id);
  if (!window || window.resetAt <= now) {
    window = { count: 0, resetAt: now + limit.windowMs };
    windows.set(id, window);
  }
  window.count += 1;
  if (windows.size > 50_000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }
  return { allowed: window.count <= limit.max, retryAfterSeconds: Math.ceil((window.resetAt - now) / 1000) };
}

export function resetRateLimits() {
  windows.clear();
}
