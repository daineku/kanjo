import type { Core } from '@strapi/strapi';

import { env, revalidateTarget } from './config';

/**
 * Tells the website that catalogue content changed.
 *
 * The site caches the catalogue for five minutes (lib/store/client.ts); this
 * call makes a publish, a price change or a stock movement visible
 * immediately. It is a courtesy, not a dependency: if the site is down or the
 * variables are unset, the cache simply expires on its own.
 *
 * Calls are coalesced for a second, so publishing twenty products is one
 * request, not twenty.
 */

const pending = new Set<string>();
let timer: NodeJS.Timeout | undefined;

export function requestRevalidation(strapi: Core.Strapi, tags: string[]) {
  const target = revalidateTarget(env());
  if (!target) return;
  for (const tag of tags) if (tag.startsWith('store-')) pending.add(tag);
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    const body = JSON.stringify({ tags: [...pending] });
    pending.clear();
    fetch(target.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${target.secret}`, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
    })
      .then((response) => {
        if (!response.ok) strapi.log.warn(`[revalidate] storefront answered ${response.status}`);
      })
      .catch((error) => strapi.log.warn(`[revalidate] ${(error as Error).message}`));
  }, 1000);
  timer.unref?.();
}
