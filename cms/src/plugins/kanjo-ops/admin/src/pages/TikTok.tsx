import { useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  LinkButton,
  SingleSelect,
  SingleSelectOption,
  Switch,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

import { API, LoadState, Notice, Panel, downloadText, errorMessage, formatDate, useResource } from './shared';

type Overview = {
  connection: {
    configured: boolean;
    status: string;
    shopId: string | null;
    shopName: string | null;
    shopRegion: string | null;
    sellerType: string | null;
    shopCurrency: string | null;
    accessTokenExpiresAt: string | null;
    refreshTokenExpiresAt: string | null;
    syncProducts: boolean;
    syncInventory: boolean;
    importOrders: boolean;
    lastSyncAt: string | null;
    lastError: string | null;
  };
  configProblems: string[];
  authorizeUrl: string | null;
  checklist: { id: string; title: string; detail: string; confidence: 'verified' | 'snippet' | 'unverified'; source?: string; action: string }[];
  callbackPath: string;
  webhookPath: string;
};

type Listing = {
  documentId: string;
  productName?: string;
  sku: string;
  tiktokProductId?: string;
  tiktokSkuId?: string;
  listingStatus?: string;
  syncEnabled?: boolean;
  lastPushedPrice?: number;
  lastPushedStock?: number;
  lastSyncedAt?: string;
  lastError?: string;
  productDocumentId: string;
};

type Job = {
  documentId: string;
  kind: string;
  subject?: string;
  status: string;
  attempts?: number;
  maxAttempts?: number;
  runAfter?: string;
  lastError?: string;
  finishedAt?: string;
  requestedBy?: string;
  createdAt: string;
};

const STATUS_TONE: Record<string, string> = {
  connected: 'success',
  awaiting_authorization: 'warning',
  not_configured: 'neutral',
  token_expired: 'danger',
  error: 'danger',
};

const CONFIDENCE_LABEL = { verified: 'verified on an official page', snippet: 'official page, seen via search snippet', unverified: 'NOT verified — confirm with TikTok' };

const KINDS = ['product_upsert', 'price_update', 'inventory_update', 'product_deactivate', 'order_import', 'fulfillment_update', 'token_refresh'];

export default function TikTokPage() {
  const { put, post, get } = useFetchClient();
  const overview = useResource<Overview>(`${API}/tiktok`);
  const listings = useResource<Listing[]>(`${API}/tiktok/listings`);
  const jobs = useResource<Job[]>(`${API}/tiktok/jobs`);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('product_upsert');
  const [subject, setSubject] = useState('');

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ tone: 'success', text: await fn() });
      await Promise.all([overview.reload(), listings.reload(), jobs.reload()]);
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const queued = (raw: unknown) => { const data = (raw ?? {}) as { queued?: boolean; reason?: string }; return data.queued ? 'Queued.' : `Not queued: ${data.reason ?? 'unknown reason'}`; };

  const setFlag = (flag: 'syncProducts' | 'syncInventory' | 'importOrders', value: boolean) =>
    act(async () => {
      await put(`${API}/tiktok/flags`, { [flag]: value });
      return `${flag} ${value ? 'enabled' : 'disabled'}.`;
    });

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const c = overview.data?.connection;
  const live = c?.status === 'connected';

  return (
    <>
      {message && <Notice tone={message.tone} title={message.tone === 'success' ? 'Done' : 'Error'}>{message.text}</Notice>}

      <Panel title="Connection" subtitle="The TikTok Shop Seller API (Partner Center). Not the TikTok content or embed APIs.">
        <LoadState loading={overview.loading} error={overview.error} />
        {overview.data && c && (
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Flex gap={3} alignItems="center">
              <Badge backgroundColor={`${STATUS_TONE[c.status] ?? 'neutral'}100`} textColor={`${STATUS_TONE[c.status] ?? 'neutral'}700`}>
                {c.status.replace(/_/g, ' ')}
              </Badge>
              {c.shopName && (
                <Typography>
                  {c.shopName} · region {c.shopRegion} · {c.sellerType} · lists in {c.shopCurrency ?? 'unknown currency'}
                </Typography>
              )}
            </Flex>
            {!live && (
              <Typography textColor="neutral600">
                Nothing is sent to TikTok until the server is configured and the seller has authorized the app. Product, inventory and order sync stay off until switched on below.
              </Typography>
            )}
            {overview.data.configProblems.length > 0 && (
              <Box>
                <Typography variant="sigma" textColor="neutral600">Server configuration</Typography>
                {overview.data.configProblems.map((problem) => (
                  <Typography key={problem} tag="p" variant="pi">• {problem}</Typography>
                ))}
              </Box>
            )}
            {c.lastError && <Notice tone="warning" title="Last error">{c.lastError}</Notice>}
            <Box>
              <Typography variant="sigma" textColor="neutral600">Register these in Partner Center</Typography>
              <Typography tag="p" variant="pi">Redirect URL: {origin}{overview.data.callbackPath}</Typography>
              <Typography tag="p" variant="pi">Webhook URL: {origin}{overview.data.webhookPath}</Typography>
            </Box>
            {overview.data.authorizeUrl && (
              <Box>
                <LinkButton href={overview.data.authorizeUrl} target="_blank" rel="noopener noreferrer">
                  Authorize the TikTok shop
                </LinkButton>
                <Typography tag="p" variant="pi" textColor="neutral600">
                  Opens TikTok Shop Seller Center. The link is valid for 30 minutes; reload this page for a fresh one.
                </Typography>
              </Box>
            )}
            {live && (
              <Typography variant="pi">
                Access token expires {formatDate(c.accessTokenExpiresAt)} (refreshed automatically) · authorization expires {formatDate(c.refreshTokenExpiresAt)} · last order sync {formatDate(c.lastSyncAt)}
              </Typography>
            )}
          </Flex>
        )}
      </Panel>

      {overview.data && (
        <Panel title="Automatic sync" subtitle="The website stock is authoritative. TikTok is told on-hand minus reserved minus each SKU’s marketplace buffer; TikTok orders reduce website stock when imported.">
          <Flex gap={6} wrap="wrap">
            <Switch disabled={!live || busy} checked={c?.syncProducts} onCheckedChange={(v: boolean) => setFlag('syncProducts', v)} onLabel="On" offLabel="Off" />
            <Typography>Products and prices</Typography>
            <Switch disabled={!live || busy} checked={c?.syncInventory} onCheckedChange={(v: boolean) => setFlag('syncInventory', v)} onLabel="On" offLabel="Off" />
            <Typography>Inventory</Typography>
            <Switch disabled={!live || busy} checked={c?.importOrders} onCheckedChange={(v: boolean) => setFlag('importOrders', v)} onLabel="On" offLabel="Off" />
            <Typography>Order import and tracking</Typography>
          </Flex>
        </Panel>
      )}

      <Panel title="Manual resync" subtitle="Queues a job even when the automatic switch is off. Requires an authorized shop.">
        <Flex gap={4} wrap="wrap" alignItems="flex-end">
          <Field.Root name="kind">
            <Field.Label>Job</Field.Label>
            <SingleSelect value={kind} onChange={(v: string | number) => setKind(String(v))}>
              {KINDS.map((k) => (
                <SingleSelectOption key={k} value={k}>{k.replace(/_/g, ' ')}</SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
          <Field.Root name="subject" hint="Product document id, SKU or order reference. Empty = all orders / the connection.">
            <Field.Label>Subject</Field.Label>
            <TextInput value={subject} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubject(e.target.value)} />
            <Field.Hint />
          </Field.Root>
          <Button disabled={busy || !live} onClick={() => act(async () => queued((await post(`${API}/tiktok/resync`, { kind, subject })).data))}>
            Queue
          </Button>
          <Button variant="secondary" disabled={busy || !live} onClick={() => act(async () => {
            const data = (await post(`${API}/tiktok/resync-all`, {})).data as { queued: number; reason?: string };
            return `${data.queued} product upsert(s) queued.${data.reason ? ` ${data.reason}` : ''}`;
          })}>
            Resync all products
          </Button>
          <Button variant="tertiary" disabled={busy || !live} onClick={() => act(async () => {
            await post(`${API}/tiktok/run`, {});
            return 'Worked the queue once.';
          })}>
            Run queue now
          </Button>
        </Flex>
      </Panel>

      <Panel title="Manual export" subtitle="For use without API access: one row per SKU with the data to copy into the CURRENT bulk-upload template downloaded from TikTok Seller Center (the template is per category and changes; this file is not that template). The blockers column says why a row should not be listed yet.">
        <Button variant="secondary" disabled={busy} onClick={() => act(async () => {
          const data = (await get(`${API}/tiktok/export`)).data as { csv: string; rows: number };
          downloadText(`kanjo-tiktok-export-${new Date().toISOString().slice(0, 10)}.csv`, data.csv);
          return `Exported ${data.rows} SKU row(s).`;
        })}>
          Download CSV
        </Button>
      </Panel>

      <Panel title="Listings">
        <LoadState loading={listings.loading} error={listings.error} />
        {listings.data && listings.data.length === 0 && <Typography textColor="neutral600">No product has been mapped to TikTok Shop yet.</Typography>}
        {listings.data && listings.data.length > 0 && (
          <Table colCount={6} rowCount={listings.data.length + 1}>
            <Thead>
              <Tr>
                <Th><Typography variant="sigma">SKU</Typography></Th>
                <Th><Typography variant="sigma">Product</Typography></Th>
                <Th><Typography variant="sigma">TikTok ids</Typography></Th>
                <Th><Typography variant="sigma">Status</Typography></Th>
                <Th><Typography variant="sigma">Last pushed</Typography></Th>
                <Th><Typography variant="sigma">Error</Typography></Th>
              </Tr>
            </Thead>
            <Tbody>
              {listings.data.map((l) => (
                <Tr key={l.documentId}>
                  <Td><Typography>{l.sku}</Typography></Td>
                  <Td><Typography>{l.productName}</Typography></Td>
                  <Td><Typography variant="pi">{l.tiktokProductId ?? '—'} / {l.tiktokSkuId ?? '—'}</Typography></Td>
                  <Td><Typography>{l.listingStatus}{l.syncEnabled === false ? ' (sync off)' : ''}</Typography></Td>
                  <Td><Typography variant="pi">price {l.lastPushedPrice ?? '—'} · stock {l.lastPushedStock ?? '—'} · {formatDate(l.lastSyncedAt)}</Typography></Td>
                  <Td><Typography variant="pi" textColor="danger600">{l.lastError ?? ''}</Typography></Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Panel>

      <Panel title="Job log" subtitle="Failed jobs are retried with backoff; after the maximum attempts a job is dead and stays here until retried.">
        <LoadState loading={jobs.loading} error={jobs.error} />
        {jobs.data && jobs.data.length === 0 && <Typography textColor="neutral600">No jobs yet.</Typography>}
        {jobs.data && jobs.data.length > 0 && (
          <Table colCount={6} rowCount={jobs.data.length + 1}>
            <Thead>
              <Tr>
                <Th><Typography variant="sigma">Job</Typography></Th>
                <Th><Typography variant="sigma">Status</Typography></Th>
                <Th><Typography variant="sigma">Attempts</Typography></Th>
                <Th><Typography variant="sigma">When</Typography></Th>
                <Th><Typography variant="sigma">Error</Typography></Th>
                <Th><Typography variant="sigma"> </Typography></Th>
              </Tr>
            </Thead>
            <Tbody>
              {jobs.data.map((j) => (
                <Tr key={j.documentId}>
                  <Td><Typography>{j.kind} · {j.subject}</Typography><Typography variant="pi" tag="p" textColor="neutral600">{j.requestedBy}</Typography></Td>
                  <Td><Typography>{j.status}</Typography></Td>
                  <Td><Typography>{j.attempts ?? 0}/{j.maxAttempts ?? 6}</Typography></Td>
                  <Td><Typography variant="pi">created {formatDate(j.createdAt)}{j.status === 'queued' ? ` · next ${formatDate(j.runAfter)}` : ''}{j.finishedAt ? ` · done ${formatDate(j.finishedAt)}` : ''}</Typography></Td>
                  <Td><Typography variant="pi" textColor="danger600">{j.lastError ?? ''}</Typography></Td>
                  <Td>
                    {['failed', 'dead', 'cancelled'].includes(j.status) && (
                      <Button size="S" variant="tertiary" disabled={busy} onClick={() => act(async () => queued((await post(`${API}/tiktok/jobs/${j.documentId}/retry`, {})).data))}>
                        Retry
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Panel>

      {overview.data && (
        <Panel title="Eligibility checklist" subtitle="Researched 2026-11-23. Facts about TikTok’s programme that this integration cannot change.">
          <Flex direction="column" alignItems="stretch" gap={4}>
            {overview.data.checklist.map((item) => (
              <Box key={item.id} paddingLeft={3} borderColor={item.confidence === 'unverified' ? 'warning500' : 'neutral200'} borderStyle="solid" borderWidth="0 0 0 3px">
                <Typography fontWeight="bold">{item.title}</Typography>
                <Typography tag="p" variant="pi" textColor="neutral600">({CONFIDENCE_LABEL[item.confidence]})</Typography>
                <Typography tag="p">{item.detail}</Typography>
                <Typography tag="p" variant="pi">Action: {item.action}</Typography>
                {item.source && <Typography tag="p" variant="pi" textColor="neutral600">Source: {item.source}</Typography>}
              </Box>
            ))}
          </Flex>
        </Panel>
      )}
    </>
  );
}
