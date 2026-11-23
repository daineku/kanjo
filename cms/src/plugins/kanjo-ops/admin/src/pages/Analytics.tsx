import { useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Grid,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';

import { API, LoadState, Notice, Panel, formatDate, formatMinor, useResource } from './shared';

type Money = {
  currency: string;
  paidOrders: number;
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  shippingCollected: number;
  paymentFeesActual: number;
  ordersWithFeeInOrderCurrency: number;
  ordersWithFeeInOtherCurrency: number;
  ordersWithFeeUnknown: number;
  productCostEstimated: number;
  linesWithoutCostEstimate: number;
  shippingCostActual: number;
  ordersWithShippingCostUnknown: number;
  estimatedOperatingProfit: number;
  completeness: string[];
  unitsSold: number;
};

type Ranked = { key: string; label: string; currency: string; units: number; revenue: number; orders: number };

type Report = {
  range: { from: string; to: string };
  includeTest: boolean;
  generatedAt: string;
  labels: Record<string, string>;
  totals: { orders: number; paidOrders: number; unitsSold: number; excludedTestOrders: number };
  money: Money[];
  paymentFeesByCurrency: { currency: string; amount: number }[];
  bestSellers: Ranked[];
  salesByCategory: Ranked[];
  salesByCountry: Ranked[];
  salesByChannel: Ranked[];
  ordersByStatus: Record<string, number>;
  pendingFulfilment: Record<string, number>;
  inventoryAlerts: { sku: string; name: string; onHand: number; reserved: number; sellable: number; lowStockThreshold: number; level: 'low' | 'out' }[];
  stripeReconciliation: { reference: string; currency: string; total: number; refunded: number; paymentIntentId: string | null; paidAt: string | null; flag?: string }[];
};

const day = (date: Date) => date.toISOString().slice(0, 10);

function Kind({ kind }: { kind: 'ACTUAL' | 'ESTIMATE' }) {
  return (
    <Badge backgroundColor={kind === 'ACTUAL' ? 'success100' : 'warning100'} textColor={kind === 'ACTUAL' ? 'success700' : 'warning700'}>
      {kind}
    </Badge>
  );
}

function Figure({ label, value, kind, note }: { label: string; value: string; kind?: 'ACTUAL' | 'ESTIMATE'; note?: string }) {
  return (
    <Box padding={4} hasRadius borderColor="neutral200" borderStyle="solid" borderWidth="1px">
      <Flex gap={2} alignItems="center">
        <Typography variant="sigma" textColor="neutral600">
          {label}
        </Typography>
        {kind && <Kind kind={kind} />}
      </Flex>
      <Box paddingTop={2}>
        <Typography variant="beta">{value}</Typography>
      </Box>
      {note && (
        <Box paddingTop={1}>
          <Typography variant="pi" textColor="neutral600">
            {note}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function RankedTable({ rows, keyLabel }: { rows: Ranked[]; keyLabel: string }) {
  if (rows.length === 0) return <Typography textColor="neutral600">No paid orders in this range.</Typography>;
  return (
    <Table colCount={5} rowCount={rows.length + 1}>
      <Thead>
        <Tr>
          <Th><Typography variant="sigma">{keyLabel}</Typography></Th>
          <Th><Typography variant="sigma">Currency</Typography></Th>
          <Th><Typography variant="sigma">Orders</Typography></Th>
          <Th><Typography variant="sigma">Units</Typography></Th>
          <Th><Typography variant="sigma">Revenue</Typography></Th>
        </Tr>
      </Thead>
      <Tbody>
        {rows.map((row) => (
          <Tr key={`${row.currency}-${row.key}`}>
            <Td><Typography>{row.label}</Typography></Td>
            <Td><Typography>{row.currency}</Typography></Td>
            <Td><Typography>{row.orders}</Typography></Td>
            <Td><Typography>{row.units}</Typography></Td>
            <Td><Typography>{formatMinor(row.revenue, row.currency)}</Typography></Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}

export default function AnalyticsPage() {
  const now = new Date();
  const [from, setFrom] = useState(day(new Date(now.getTime() - 30 * 86_400_000)));
  const [to, setTo] = useState(day(now));
  const [includeTest, setIncludeTest] = useState(false);
  const [query, setQuery] = useState({ from, to, includeTest });

  const path = useMemo(() => {
    const end = new Date(`${query.to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1); // the "to" day is inclusive
    const params = new URLSearchParams({
      from: `${query.from}T00:00:00Z`,
      to: end.toISOString(),
      includeTest: String(query.includeTest),
    });
    return `${API}/analytics?${params.toString()}`;
  }, [query]);

  const { data, error, loading } = useResource<Report>(path);

  return (
    <>
      <Panel title="Range" subtitle="Orders are counted by the date they were placed (UTC). Test-mode orders are excluded unless included here.">
        <Flex gap={4} alignItems="flex-end" wrap="wrap">
          <Field.Root name="from">
            <Field.Label>From</Field.Label>
            <TextInput type="date" value={from} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)} />
          </Field.Root>
          <Field.Root name="to">
            <Field.Label>To (inclusive)</Field.Label>
            <TextInput type="date" value={to} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)} />
          </Field.Root>
          <Checkbox checked={includeTest} onCheckedChange={(value: boolean | 'indeterminate') => setIncludeTest(value === true)}>
            Include test orders
          </Checkbox>
          <Button onClick={() => setQuery({ from, to, includeTest })}>Update</Button>
        </Flex>
      </Panel>

      <LoadState loading={loading} error={error} />

      {data && !loading && (
        <>
          <Notice tone="default" title="How to read these figures">
            Revenue is not profit. ACTUAL figures come from the payment processor or from fulfilment records; ESTIMATE figures use the
            cost price recorded on each order line. Amounts in different currencies are never added together.
          </Notice>

          <Panel title="Orders">
            <Grid.Root gap={4}>
              <Grid.Item col={3} s={12}><Figure label="Orders" value={String(data.totals.orders)} /></Grid.Item>
              <Grid.Item col={3} s={12}><Figure label="Paid orders" value={String(data.totals.paidOrders)} /></Grid.Item>
              <Grid.Item col={3} s={12}><Figure label="Units sold" value={String(data.totals.unitsSold)} /></Grid.Item>
              <Grid.Item col={3} s={12}><Figure label="Test orders excluded" value={String(data.totals.excludedTestOrders)} /></Grid.Item>
            </Grid.Root>
          </Panel>

          {data.money.length === 0 && <Notice tone="default" title="No paid orders">There are no paid orders in this range.</Notice>}

          {data.money.map((m) => (
            <Panel key={m.currency} title={`Money — ${m.currency}`} subtitle={`${m.paidOrders} paid order(s) in ${m.currency}`}>
              <Grid.Root gap={4}>
                <Grid.Item col={4} s={12}><Figure label="Gross revenue" kind="ACTUAL" value={formatMinor(m.grossRevenue, m.currency)} note={data.labels.grossRevenue} /></Grid.Item>
                <Grid.Item col={4} s={12}><Figure label="Refunds" kind="ACTUAL" value={formatMinor(m.refunds, m.currency)} /></Grid.Item>
                <Grid.Item col={4} s={12}><Figure label="Net revenue" kind="ACTUAL" value={formatMinor(m.netRevenue, m.currency)} note="Revenue, not profit." /></Grid.Item>
                <Grid.Item col={4} s={12}>
                  <Figure
                    label="Payment fees"
                    kind="ACTUAL"
                    value={formatMinor(m.paymentFeesActual, m.currency)}
                    note={`Known for ${m.ordersWithFeeInOrderCurrency} order(s) in ${m.currency}; ${m.ordersWithFeeInOtherCurrency} charged in another currency; ${m.ordersWithFeeUnknown} unknown.`}
                  />
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  <Figure label="Product costs" kind="ESTIMATE" value={formatMinor(m.productCostEstimated, m.currency)} note={`${m.linesWithoutCostEstimate} line(s) have no cost estimate.`} />
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  <Figure
                    label="Postage paid"
                    kind="ACTUAL"
                    value={formatMinor(m.shippingCostActual, m.currency)}
                    note={`Shipping collected from customers: ${formatMinor(m.shippingCollected, m.currency)}. Not entered for ${m.ordersWithShippingCostUnknown} order(s).`}
                  />
                </Grid.Item>
                <Grid.Item col={12} s={12}>
                  <Figure
                    label="Estimated operating profit"
                    kind="ESTIMATE"
                    value={formatMinor(m.estimatedOperatingProfit, m.currency)}
                    note={`Incomplete: ${m.completeness.join('; ')}.`}
                  />
                </Grid.Item>
              </Grid.Root>
            </Panel>
          ))}

          {data.paymentFeesByCurrency.length > 0 && (
            <Panel title="Payment fees by charged currency" subtitle="ACTUAL. A Thai Stripe account reports fees in THB, the settlement currency.">
              {data.paymentFeesByCurrency.map((fee) => (
                <Typography key={fee.currency} tag="p">
                  {formatMinor(fee.amount, fee.currency)}
                </Typography>
              ))}
            </Panel>
          )}

          <Panel title="Pending fulfilment">
            <Flex gap={6} wrap="wrap">
              {Object.entries(data.pendingFulfilment).map(([status, count]) => (
                <Figure key={status} label={status.replace(/_/g, ' ')} value={String(count)} />
              ))}
            </Flex>
          </Panel>

          <Panel title="Best sellers"><RankedTable rows={data.bestSellers} keyLabel="Product" /></Panel>
          <Panel title="Sales by category"><RankedTable rows={data.salesByCategory} keyLabel="Category" /></Panel>
          <Panel title="Sales by country" subtitle="Net of refunds, by shipping destination."><RankedTable rows={data.salesByCountry} keyLabel="Country" /></Panel>
          <Panel title="Sales by channel" subtitle="Net of refunds."><RankedTable rows={data.salesByChannel} keyLabel="Channel" /></Panel>

          <Panel title="Inventory alerts" subtitle="Sellable units (on hand minus reserved) at or below the low-stock threshold.">
            {data.inventoryAlerts.length === 0 ? (
              <Typography textColor="neutral600">No stock alerts.</Typography>
            ) : (
              <Table colCount={5} rowCount={data.inventoryAlerts.length + 1}>
                <Thead>
                  <Tr>
                    <Th><Typography variant="sigma">SKU</Typography></Th>
                    <Th><Typography variant="sigma">Product</Typography></Th>
                    <Th><Typography variant="sigma">On hand</Typography></Th>
                    <Th><Typography variant="sigma">Reserved</Typography></Th>
                    <Th><Typography variant="sigma">Sellable</Typography></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {data.inventoryAlerts.map((row) => (
                    <Tr key={row.sku}>
                      <Td><Typography>{row.sku}</Typography></Td>
                      <Td><Typography>{row.name}</Typography></Td>
                      <Td><Typography>{row.onHand}</Typography></Td>
                      <Td><Typography>{row.reserved}</Typography></Td>
                      <Td>
                        <Badge backgroundColor={row.level === 'out' ? 'danger100' : 'warning100'} textColor={row.level === 'out' ? 'danger700' : 'warning700'}>
                          {row.sellable} / threshold {row.lowStockThreshold}
                        </Badge>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </Panel>

          <Panel title="Stripe reconciliation" subtitle="Every paid web order with its payment intent. Match these against the Stripe dashboard's payments for the same period.">
            {data.stripeReconciliation.length === 0 ? (
              <Typography textColor="neutral600">No paid web orders in this range.</Typography>
            ) : (
              <Table colCount={5} rowCount={data.stripeReconciliation.length + 1}>
                <Thead>
                  <Tr>
                    <Th><Typography variant="sigma">Order</Typography></Th>
                    <Th><Typography variant="sigma">Paid</Typography></Th>
                    <Th><Typography variant="sigma">Total</Typography></Th>
                    <Th><Typography variant="sigma">Refunded</Typography></Th>
                    <Th><Typography variant="sigma">Payment intent</Typography></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {data.stripeReconciliation.map((row) => (
                    <Tr key={row.reference}>
                      <Td><Typography>{row.reference}</Typography></Td>
                      <Td><Typography>{formatDate(row.paidAt)}</Typography></Td>
                      <Td><Typography>{formatMinor(row.total, row.currency)}</Typography></Td>
                      <Td><Typography>{formatMinor(row.refunded, row.currency)}</Typography></Td>
                      <Td>
                        {row.flag ? (
                          <Badge backgroundColor="danger100" textColor="danger700">{row.flag}</Badge>
                        ) : (
                          <Typography>{row.paymentIntentId}</Typography>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </Panel>

          <Typography variant="pi" textColor="neutral600">
            Generated {formatDate(data.generatedAt)}.
          </Typography>
        </>
      )}
    </>
  );
}
