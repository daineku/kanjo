import { ChartPie } from '@strapi/icons';

const PLUGIN_ID = 'kanjo-ops';

/**
 * Admin entry: one menu link, "Kanjo Ops", to a tabbed page (Analytics,
 * Imports, TikTok Shop). The link is shown to anyone holding at least one of
 * the plugin's three actions; each tab, and each server route behind it,
 * checks its own action.
 */
export default {
  register(app: any) {
    app.addMenuLink({
      to: `/plugins/${PLUGIN_ID}`,
      icon: ChartPie,
      intlLabel: { id: `${PLUGIN_ID}.plugin.name`, defaultMessage: 'Kanjo Ops' },
      Component: () => import('./pages/App'),
      permissions: [
        { action: 'plugin::kanjo-ops.analytics.read', subject: null },
        { action: 'plugin::kanjo-ops.imports.manage', subject: null },
        { action: 'plugin::kanjo-ops.tiktok.manage', subject: null },
      ],
    });
    app.registerPlugin({ id: PLUGIN_ID, name: 'Kanjo Ops' });
  },

  bootstrap() {},

  async registerTrads() {
    return [];
  },
};
