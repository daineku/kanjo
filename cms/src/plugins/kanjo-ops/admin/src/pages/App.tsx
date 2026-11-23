import { Box, Main, Tabs, Typography } from '@strapi/design-system';
import { useRBAC } from '@strapi/strapi/admin';

import AnalyticsPage from './Analytics';
import ImportsPage from './Imports';
import TikTokPage from './TikTok';

const PERMISSIONS = {
  analytics: [{ action: 'plugin::kanjo-ops.analytics.read', subject: null }],
  imports: [{ action: 'plugin::kanjo-ops.imports.manage', subject: null }],
  tiktok: [{ action: 'plugin::kanjo-ops.tiktok.manage', subject: null }],
};

/**
 * The page behind the "Kanjo Ops" menu link. Each tab is rendered only for a
 * role that holds its action; the server enforces the same rule per route.
 */
export default function App() {
  const analytics = useRBAC(PERMISSIONS.analytics);
  const imports = useRBAC(PERMISSIONS.imports);
  const tiktok = useRBAC(PERMISSIONS.tiktok);

  const loading = analytics.isLoading || imports.isLoading || tiktok.isLoading;
  const tabs = [
    { id: 'analytics', label: 'Analytics', allowed: analytics.allowedActions.canRead, render: () => <AnalyticsPage /> },
    { id: 'imports', label: 'Supplier imports', allowed: imports.allowedActions.canManage, render: () => <ImportsPage /> },
    { id: 'tiktok', label: 'TikTok Shop', allowed: tiktok.allowedActions.canManage, render: () => <TikTokPage /> },
  ].filter((tab) => tab.allowed);

  return (
    <Main>
      <Box paddingLeft={10} paddingRight={10} paddingTop={8} paddingBottom={4}>
        <Typography variant="alpha" tag="h1">
          Kanjo Ops
        </Typography>
        <Box paddingTop={1}>
          <Typography variant="epsilon" textColor="neutral600">
            Sales analytics, supplier imports and the TikTok Shop integration for The Kanjo Parts.
          </Typography>
        </Box>
      </Box>
      <Box paddingLeft={10} paddingRight={10} paddingBottom={10}>
        {loading ? null : tabs.length === 0 ? (
          <Typography>Your role has no access to Kanjo Ops.</Typography>
        ) : (
          <Tabs.Root defaultValue={tabs[0]!.id}>
            <Tabs.List aria-label="Kanjo Ops sections">
              {tabs.map((tab) => (
                <Tabs.Trigger key={tab.id} value={tab.id}>
                  {tab.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            {tabs.map((tab) => (
              <Tabs.Content key={tab.id} value={tab.id}>
                <Box paddingTop={6}>{tab.render()}</Box>
              </Tabs.Content>
            ))}
          </Tabs.Root>
        )}
      </Box>
    </Main>
  );
}
