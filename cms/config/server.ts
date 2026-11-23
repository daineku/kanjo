import type { Core } from '@strapi/strapi';

import cronTasks from './cron-tasks';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  // The CMS's own public origin (https://cms.thekanjo.com). Used for absolute
  // media URLs and the admin's links.
  url: env('PUBLIC_URL', ''),
  proxy: env.bool('IS_PROXIED', false),
  app: {
    keys: env.array('APP_KEYS')!,
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  cron: {
    enabled: env.bool('CRON_ENABLED', true),
    tasks: cronTasks,
  },
});

export default config;
