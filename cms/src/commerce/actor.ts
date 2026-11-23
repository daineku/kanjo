import { AsyncLocalStorage } from 'node:async_hooks';
import type { Core } from '@strapi/strapi';

/**
 * Who is making a change.
 *
 * The guard middlewares in ./guards.ts refuse certain edits when they come
 * from a person in the admin panel — marking a web order as paid, changing a
 * financial snapshot, typing into the `reserved` stock counter. The commerce
 * code itself has to make exactly those writes, so it runs them inside
 * `runAsSystem`, and the guards let a system write through.
 *
 * It is an AsyncLocalStorage rather than a parameter because the writes go
 * through Strapi's Document Service, whose middleware signature has no place
 * to carry one.
 */

const store = new AsyncLocalStorage<{ label: string }>();

export function runAsSystem<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ label }, fn);
}

export function isSystem(): boolean {
  return store.getStore() !== undefined;
}

/** `system:<label>` inside runAsSystem, the admin's email in an admin request, else `system`. */
export function actorName(strapi: Core.Strapi): string {
  const system = store.getStore();
  if (system) return `system:${system.label}`;
  try {
    const user = (strapi as any).requestContext?.get?.()?.state?.user;
    if (user?.email) return `admin:${String(user.email).toLowerCase()}`;
  } catch {
    // No request context (cron, scripts): fall through.
  }
  return 'system';
}
