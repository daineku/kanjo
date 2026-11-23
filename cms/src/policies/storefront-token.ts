import type { Core } from '@strapi/strapi';

import { env, storefrontToken } from '../commerce/config';
import { safeEqual } from '../commerce/util';

/**
 * The storefront API is called by ONE client: the website's server, holding
 * STOREFRONT_API_TOKEN. Browsers never reach it, so no customer data, stock
 * level or checkout operation is exposed through Strapi's public role.
 *
 * With no token configured the API refuses everything — a forgotten variable
 * closes the store rather than opening it.
 */
export default (policyContext: any, _config: unknown, { strapi }: { strapi: Core.Strapi }) => {
  const expected = storefrontToken(env());
  if (!expected) {
    strapi.log.warn('[storefront] STOREFRONT_API_TOKEN is not set (or shorter than 32 characters); refusing request.');
    return false;
  }
  const header = String(policyContext.request?.header?.authorization ?? '');
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return presented !== '' && safeEqual(presented, expected);
};
