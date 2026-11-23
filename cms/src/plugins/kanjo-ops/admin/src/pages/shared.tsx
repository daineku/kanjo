import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Flex, Loader, Typography } from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

export const API = '/kanjo-ops';

/** Minor units → "1,234.56 USD". Never sums or converts. */
export function formatMinor(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined) return '—';
  const value = (amount / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value} ${currency}`;
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—';
}

export function errorMessage(error: unknown): string {
  const anyError = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return anyError?.response?.data?.error?.message ?? anyError?.message ?? 'Request failed';
}

/** GET with loading/error state and a reload function. */
export function useResource<T>(path: string | null) {
  const { get } = useFetchClient();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path));

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const response = await get(path);
      setData(response.data as T);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [get, path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

export function LoadState({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) {
    return (
      <Box paddingBottom={4}>
        <Alert variant="danger" title="Error" closeLabel="Close">
          {error}
        </Alert>
      </Box>
    );
  }
  if (loading) {
    return (
      <Flex justifyContent="center" padding={6}>
        <Loader small>Loading</Loader>
      </Flex>
    );
  }
  return null;
}

export function Notice({ tone, title, children }: { tone: 'success' | 'danger' | 'warning' | 'default'; title: string; children: React.ReactNode }) {
  return (
    <Box paddingBottom={4}>
      <Alert variant={tone} title={title} closeLabel="Close">
        {children}
      </Alert>
    </Box>
  );
}

export function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Box background="neutral0" hasRadius shadow="tableShadow" padding={6} marginBottom={6}>
      <Typography variant="delta" tag="h2">
        {title}
      </Typography>
      {subtitle && (
        <Box paddingTop={1}>
          <Typography variant="pi" textColor="neutral600">
            {subtitle}
          </Typography>
        </Box>
      )}
      <Box paddingTop={4}>{children}</Box>
    </Box>
  );
}

/** Reads a chosen file as text in the browser. */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsText(file, 'utf-8');
  });
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
