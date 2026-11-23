import type { Core } from '@strapi/strapi';

import { actorName, runAsSystem } from './actor';

/**
 * The audit log: who did what to which record.
 *
 * Append-only by convention and by permission — no admin role is granted
 * update or delete on `audit-log` (see ./roles.ts). An audit write must never
 * be the reason a real operation fails, so errors are logged and swallowed.
 *
 * NEVER put a secret, a full address or a payment credential in `data`.
 */
export async function audit(
  strapi: Core.Strapi,
  entry: {
    action: string;
    actor?: string;
    subjectType?: string;
    subjectId?: string;
    summary?: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  // The actor is resolved BEFORE entering the system context, so an admin's
  // action is attributed to the admin; the write itself is a system write.
  const actor = entry.actor ?? actorName(strapi);
  try {
    await runAsSystem('audit', () => strapi.documents('api::audit-log.audit-log' as any).create({
      data: {
        action: entry.action,
        actor,
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        summary: entry.summary?.slice(0, 2000),
        data: entry.data,
      } as any,
    }));
  } catch (error) {
    strapi.log.error(`[audit] could not record "${entry.action}": ${(error as Error).message}`);
  }
}
