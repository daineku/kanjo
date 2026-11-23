import { useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  TextInput,
  Textarea,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

import { API, LoadState, Notice, Panel, errorMessage, formatDate, readFileText, useResource } from './shared';

type Supplier = { documentId: string; name: string; code: string; active?: boolean; accessMethod?: string; contentRights?: string };
type Source = { id: string; authorization: string; available: boolean };
type Batch = {
  documentId: string;
  label: string;
  status: string;
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  promotedRows: number;
  createdAt: string;
  createdByName?: string;
  log?: string;
  supplier?: { name: string } | null;
};
type Issue = { level: 'error' | 'warning'; field?: string; message: string };
type Item = {
  documentId: string;
  rowNumber: number;
  name?: string;
  supplierReference?: string;
  sourceUrl?: string;
  state: 'valid' | 'invalid' | 'duplicate';
  decision: 'pending' | 'approved' | 'rejected';
  duplicateOf?: string;
  productDocumentId?: string;
  normalized?: { sku?: string; sourcePrice?: number; sourceCurrency?: string; categoryName?: string; authenticity?: string };
  issues?: { issues?: Issue[] };
};

const AUTHENTICITY = ['', 'genuine_oem', 'genuine_aftermarket', 'third_party_replacement', 'replica_reproduction', 'custom_made', 'unverified'];

const stateBadge = (state: Item['state']) => {
  const tone = state === 'valid' ? 'success' : state === 'duplicate' ? 'warning' : 'danger';
  return <Badge backgroundColor={`${tone}100`} textColor={`${tone}700`}>{state}</Badge>;
};

function BatchDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { post } = useFetchClient();
  const { data, error, loading, reload } = useResource<{ batch: Batch; items: Item[] }>(`${API}/imports/batches/${id}`);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [authenticity, setAuthenticity] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const decide = async (item: Item, decision: Item['decision']) => {
    setBusy(true);
    setMessage(null);
    try {
      await post(`${API}/imports/items/${item.documentId}/decision`, { decision, authenticity: authenticity[item.documentId] || undefined });
      await reload();
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await post(`${API}/imports/batches/${id}/promote`, {});
      const result = response.data as { promoted: number; skipped: { row: number; reason: string }[] };
      setMessage({
        tone: 'success',
        text: `${result.promoted} draft product(s) created.${result.skipped.length ? ` Skipped: ${result.skipped.map((s) => `row ${s.row} — ${s.reason}`).join('; ')}` : ''} Open them in the Content Manager to write copy, set the price, add cleared images and approve.`,
      });
      await reload();
      onChanged();
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <LoadState loading={loading} error={error} />;
  const approvedWaiting = data.items.filter((item) => item.decision === 'approved' && !item.productDocumentId).length;

  return (
    <Panel title={`Review: ${data.batch.label}`} subtitle={data.batch.log}>
      {message && <Notice tone={message.tone} title={message.tone === 'success' ? 'Done' : 'Error'}>{message.text}</Notice>}
      <Box paddingBottom={4}>
        <Button onClick={promote} disabled={busy || approvedWaiting === 0}>
          Create {approvedWaiting} draft product(s) from approved rows
        </Button>
      </Box>
      <Table colCount={7} rowCount={data.items.length + 1}>
        <Thead>
          <Tr>
            <Th><Typography variant="sigma">Row</Typography></Th>
            <Th><Typography variant="sigma">Item</Typography></Th>
            <Th><Typography variant="sigma">Source price</Typography></Th>
            <Th><Typography variant="sigma">State</Typography></Th>
            <Th><Typography variant="sigma">Issues</Typography></Th>
            <Th><Typography variant="sigma">Authenticity (reviewer)</Typography></Th>
            <Th><Typography variant="sigma">Decision</Typography></Th>
          </Tr>
        </Thead>
        <Tbody>
          {data.items.map((item) => (
            <Tr key={item.documentId}>
              <Td><Typography>{item.rowNumber}</Typography></Td>
              <Td>
                <Typography fontWeight="bold">{item.name || '(no name)'}</Typography>
                <Typography variant="pi" tag="p" textColor="neutral600">
                  {item.normalized?.sku} · ref {item.supplierReference} · {item.normalized?.categoryName ?? 'no category'}
                </Typography>
              </Td>
              <Td>
                <Typography>
                  {item.normalized?.sourcePrice !== undefined ? `${item.normalized.sourcePrice} ${item.normalized.sourceCurrency ?? ''}` : '—'}
                </Typography>
              </Td>
              <Td>
                {stateBadge(item.state)}
                {item.duplicateOf && <Typography variant="pi" tag="p">{item.duplicateOf}</Typography>}
              </Td>
              <Td>
                {(item.issues?.issues ?? []).map((issue, index) => (
                  <Typography key={index} variant="pi" tag="p" textColor={issue.level === 'error' ? 'danger600' : 'warning600'}>
                    {issue.level.toUpperCase()}: {issue.message}
                  </Typography>
                ))}
              </Td>
              <Td>
                {item.state === 'valid' && !item.productDocumentId ? (
                  <SingleSelect
                    aria-label="Authenticity"
                    placeholder={item.normalized?.authenticity ?? 'unverified'}
                    value={authenticity[item.documentId] ?? ''}
                    onChange={(value: string | number) => setAuthenticity({ ...authenticity, [item.documentId]: String(value) })}
                  >
                    {AUTHENTICITY.map((value) => (
                      <SingleSelectOption key={value || 'keep'} value={value}>
                        {value || 'keep current'}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                ) : (
                  <Typography>{item.normalized?.authenticity ?? '—'}</Typography>
                )}
              </Td>
              <Td>
                {item.productDocumentId ? (
                  <Badge backgroundColor="success100" textColor="success700">draft created</Badge>
                ) : (
                  <Flex gap={2} wrap="wrap">
                    <Typography variant="pi">{item.decision}</Typography>
                    {item.state === 'valid' && item.decision !== 'approved' && (
                      <Button size="S" variant="success-light" disabled={busy} onClick={() => decide(item, 'approved')}>Approve</Button>
                    )}
                    {item.decision !== 'rejected' && (
                      <Button size="S" variant="danger-light" disabled={busy} onClick={() => decide(item, 'rejected')}>Reject</Button>
                    )}
                  </Flex>
                )}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Panel>
  );
}

export default function ImportsPage() {
  const { post } = useFetchClient();
  const meta = useResource<{ sources: Source[]; suppliers: Supplier[] }>(`${API}/imports/meta`);
  const batches = useResource<Batch[]>(`${API}/imports/batches`);

  const [supplierId, setSupplierId] = useState('');
  const [label, setLabel] = useState('');
  const [csv, setCsv] = useState('');
  const [mode, setMode] = useState<'import' | 'reverify'>('import');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [openBatch, setOpenBatch] = useState<string | null>(null);

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setCsv(await readFileText(file));
      if (!label) setLabel(file.name.replace(/\.csv$/i, ''));
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    }
  };

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'import') {
        const response = await post(`${API}/imports/batches`, { supplierDocumentId: supplierId, source: 'csv', label: label || undefined, csv });
        const result = response.data as { batchDocumentId: string; totalRows: number; validRows: number; duplicateRows: number; invalidRows: number };
        setMessage({
          tone: 'success',
          text: `${result.totalRows} rows read: ${result.validRows} valid, ${result.duplicateRows} duplicates, ${result.invalidRows} invalid. Nothing has been added to the catalogue yet — review the rows below.`,
        });
        setOpenBatch(result.batchDocumentId);
        await batches.reload();
      } else {
        const response = await post(`${API}/imports/reverify`, { supplierDocumentId: supplierId, csv });
        const result = response.data as { matched: number; updated: number; unmatched: string[]; priceChanges: { sku: string; from?: number; to: number }[] };
        setMessage({
          tone: 'success',
          text: `Re-verified ${result.updated} product(s). ${result.priceChanges.length} source price change(s)${result.priceChanges.length ? `: ${result.priceChanges.slice(0, 10).map((c) => `${c.sku} ${c.from ?? '—'} → ${c.to}`).join(', ')}` : ''}. ${result.unmatched.length} row(s) matched no product. Public prices were not changed.`,
        });
      }
      setCsv('');
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel
        title="Import supplier data"
        subtitle="CSV only. Use the template in cms/templates/. Imported rows become DRAFT products with no public price, no images and no public description — a person completes and approves each one before it can be published."
      >
        <LoadState loading={meta.loading} error={meta.error} />
        {message && <Notice tone={message.tone} title={message.tone === 'success' ? 'Done' : 'Error'}>{message.text}</Notice>}
        {meta.data && (
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Flex gap={4} wrap="wrap" alignItems="flex-end">
              <Field.Root name="mode">
                <Field.Label>Action</Field.Label>
                <SingleSelect value={mode} onChange={(value: string | number) => setMode(value as 'import' | 'reverify')}>
                  <SingleSelectOption value="import">New import (review, then create drafts)</SingleSelectOption>
                  <SingleSelectOption value="reverify">Re-verify existing products (price and availability)</SingleSelectOption>
                </SingleSelect>
              </Field.Root>
              <Field.Root name="supplier" required>
                <Field.Label>Supplier</Field.Label>
                <SingleSelect placeholder="Choose a supplier" value={supplierId} onChange={(value: string | number) => setSupplierId(String(value))}>
                  {meta.data.suppliers.filter((s) => s.active !== false).map((s) => (
                    <SingleSelectOption key={s.documentId} value={s.documentId}>
                      {s.name} ({s.code})
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
              {mode === 'import' && (
                <Field.Root name="label">
                  <Field.Label>Batch label</Field.Label>
                  <TextInput value={label} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)} />
                </Field.Root>
              )}
            </Flex>
            {meta.data.suppliers.length === 0 && (
              <Typography textColor="neutral600">No suppliers yet. Create one in Content Manager → Supplier first.</Typography>
            )}
            <Field.Root name="file">
              <Field.Label>CSV file</Field.Label>
              <input type="file" accept=".csv,text/csv" onChange={onFile} />
            </Field.Root>
            <Field.Root name="csv">
              <Field.Label>…or paste CSV</Field.Label>
              <Textarea value={csv} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCsv(e.target.value)} />
            </Field.Root>
            <Box>
              <Button onClick={submit} loading={busy} disabled={busy || !supplierId || !csv.trim()}>
                {mode === 'import' ? 'Read and check rows' : 'Re-verify'}
              </Button>
            </Box>
            <Box>
              <Typography variant="sigma" textColor="neutral600">Other sources</Typography>
              {meta.data.sources.filter((s) => !s.available).map((s) => (
                <Typography key={s.id} variant="pi" tag="p" textColor="neutral600">
                  {s.id}: {s.authorization}
                </Typography>
              ))}
            </Box>
          </Flex>
        )}
      </Panel>

      {openBatch && <BatchDetail key={openBatch} id={openBatch} onChanged={() => void batches.reload()} />}

      <Panel title="Recent batches">
        <LoadState loading={batches.loading} error={batches.error} />
        {batches.data && batches.data.length === 0 && <Typography textColor="neutral600">No imports yet.</Typography>}
        {batches.data && batches.data.length > 0 && (
          <Table colCount={6} rowCount={batches.data.length + 1}>
            <Thead>
              <Tr>
                <Th><Typography variant="sigma">Batch</Typography></Th>
                <Th><Typography variant="sigma">Supplier</Typography></Th>
                <Th><Typography variant="sigma">Status</Typography></Th>
                <Th><Typography variant="sigma">Rows</Typography></Th>
                <Th><Typography variant="sigma">Created</Typography></Th>
                <Th><Typography variant="sigma"> </Typography></Th>
              </Tr>
            </Thead>
            <Tbody>
              {batches.data.map((b) => (
                <Tr key={b.documentId}>
                  <Td><Typography>{b.label}</Typography></Td>
                  <Td><Typography>{b.supplier?.name ?? '—'}</Typography></Td>
                  <Td><Typography>{b.status}</Typography></Td>
                  <Td>
                    <Typography>
                      {b.totalRows} total · {b.validRows} valid · {b.duplicateRows} dup · {b.invalidRows} invalid · {b.promotedRows ?? 0} drafted
                    </Typography>
                  </Td>
                  <Td><Typography>{formatDate(b.createdAt)}{b.createdByName ? ` · ${b.createdByName}` : ''}</Typography></Td>
                  <Td><Button size="S" variant="tertiary" onClick={() => setOpenBatch(b.documentId)}>Review</Button></Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
