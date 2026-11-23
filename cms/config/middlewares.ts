import type { Core } from '@strapi/strapi';

/**
 * `strapi::body` keeps the UNPARSED body (Symbol.for('unparsedBody')) because
 * payment and marketplace webhooks are signed over the exact bytes sent; a
 * re-serialised JSON body does not verify. The JSON limit covers a review
 * with three downscaled photos as base64.
 *
 * The CSP allows the R2 media host in the admin, so uploaded images display.
 */
const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Middlewares => {
  const mediaHost = (() => {
    try {
      const value = env('R2_PUBLIC_BASE_URL', '');
      return value ? new URL(value).host : undefined;
    } catch {
      return undefined;
    }
  })();
  const media = ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', ...(mediaHost ? [mediaHost] : [])];

  return [
    'strapi::logger',
    'strapi::errors',
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            'connect-src': ["'self'", 'https:'],
            'img-src': media,
            'media-src': media,
            upgradeInsecureRequests: null,
          },
        },
      },
    },
    {
      name: 'strapi::cors',
      // Only the website's SERVER calls the CMS API; browsers never do. The
      // admin is same-origin. So no cross-origin browser access is granted.
      config: { origin: env.array('CORS_ORIGINS', []) },
    },
    'strapi::poweredBy',
    'strapi::query',
    {
      name: 'strapi::body',
      config: { includeUnparsed: true, jsonLimit: '16mb', formLimit: '1mb', textLimit: '1mb' },
    },
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
  ];
};

export default config;
