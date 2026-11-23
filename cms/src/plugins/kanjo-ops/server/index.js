'use strict';

/**
 * kanjo-ops — server half.
 *
 * ACCESS CONTROL
 *   Admin routes (`/kanjo-ops/...`, admin JWT required) are each guarded by
 *   `admin::hasPermissions` with one of three plugin actions, assignable per
 *   admin role in Settings → Roles:
 *     plugin::kanjo-ops.analytics.read   sales and profit figures
 *     plugin::kanjo-ops.imports.manage   supplier imports
 *     plugin::kanjo-ops.tiktok.manage    TikTok Shop connection and sync
 *   Two content-API routes are public by necessity and authenticate otherwise:
 *     POST /api/kanjo-ops/tiktok/webhook          HMAC signature (tiktok/webhook.ts)
 *     GET  /api/kanjo-ops/tiktok/oauth/callback   signed, expiring `state`
 *
 * Every mutating admin route writes an audit-log entry (inside the app code
 * it calls).
 */

const ACTIONS = {
  analytics: 'plugin::kanjo-ops.analytics.read',
  imports: 'plugin::kanjo-ops.imports.manage',
  tiktok: 'plugin::kanjo-ops.tiktok.manage',
};

const guard = (action) => ({
  policies: [{ name: 'admin::hasPermissions', config: { actions: [action] } }],
});

const route = (method, path, handler, action) => ({
  method,
  path,
  handler: `ops.${handler}`,
  config: guard(action),
});

const adminRoutes = [
  route('GET', '/analytics', 'analytics', ACTIONS.analytics),

  route('GET', '/imports/meta', 'importMeta', ACTIONS.imports),
  route('GET', '/imports/batches', 'importBatches', ACTIONS.imports),
  route('GET', '/imports/batches/:id', 'importBatch', ACTIONS.imports),
  route('POST', '/imports/batches', 'importCreate', ACTIONS.imports),
  route('POST', '/imports/items/:id/decision', 'importDecide', ACTIONS.imports),
  route('POST', '/imports/batches/:id/promote', 'importPromote', ACTIONS.imports),
  route('POST', '/imports/reverify', 'importReverify', ACTIONS.imports),

  route('GET', '/tiktok', 'tiktokOverview', ACTIONS.tiktok),
  route('PUT', '/tiktok/flags', 'tiktokFlags', ACTIONS.tiktok),
  route('GET', '/tiktok/listings', 'tiktokListings', ACTIONS.tiktok),
  route('GET', '/tiktok/jobs', 'tiktokJobs', ACTIONS.tiktok),
  route('POST', '/tiktok/resync', 'tiktokResync', ACTIONS.tiktok),
  route('POST', '/tiktok/resync-all', 'tiktokResyncAll', ACTIONS.tiktok),
  route('POST', '/tiktok/jobs/:id/retry', 'tiktokRetry', ACTIONS.tiktok),
  route('POST', '/tiktok/run', 'tiktokRun', ACTIONS.tiktok),
  route('GET', '/tiktok/export', 'tiktokExport', ACTIONS.tiktok),
];

const publicRoutes = [
  {
    method: 'POST',
    path: '/tiktok/webhook',
    handler: 'ops.tiktokWebhook',
    config: { auth: false },
  },
  {
    method: 'GET',
    path: '/tiktok/oauth/callback',
    handler: 'ops.tiktokCallback',
    config: { auth: false },
  },
];

module.exports = () => ({
  register() {},

  async bootstrap({ strapi }) {
    await strapi.admin.services.permission.actionProvider.registerMany([
      { section: 'plugins', displayName: 'View sales analytics', uid: 'analytics.read', pluginName: 'kanjo-ops' },
      { section: 'plugins', displayName: 'Manage supplier imports', uid: 'imports.manage', pluginName: 'kanjo-ops' },
      { section: 'plugins', displayName: 'Manage TikTok Shop', uid: 'tiktok.manage', pluginName: 'kanjo-ops' },
    ]);
  },

  routes: {
    admin: { type: 'admin', routes: adminRoutes },
    'content-api': { type: 'content-api', routes: publicRoutes },
  },

  controllers: { ops: require('./controller') },
});

module.exports.ACTIONS = ACTIONS;
