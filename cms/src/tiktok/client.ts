import { signRequest } from './sign';
import type { FetchLike, TikTokConfig, TikTokShop, TikTokTokenSet } from './types';

/**
 * A small typed client for the TikTok Shop Open API.
 *
 * `fetch` is injected so every code path here is exercised in tests against a
 * mock — clearly a mock, in a test file — without a seller account. Nothing in
 * this file is ever "simulated" at runtime: with no credentials there is no
 * client, and with credentials every call goes to TikTok.
 *
 * ENDPOINT PROVENANCE. Paths under 202309 come from the official doc tree
 * (names/versions) plus open-source SDK source (exact paths). Several
 * operations now have newer doc versions (edit product 202509, search products
 * 202502, order detail 202507, mark-as-shipped 202610). TikTok keeps an old
 * version available for at least two months after a new one ships, so each
 * version string below is a constant that can be overridden per call site by
 * env, and each MUST be confirmed in Partner Center before go-live.
 */

export class TikTokApiError extends Error {
  status: number;
  code: number | undefined;
  rateLimited: boolean;
  /** Milliseconds the server asked us to wait, when it said. */
  retryAfterMs: number | undefined;
  /** False for errors that will not succeed on retry (validation, auth). */
  retryable: boolean;
  requestId: string | undefined;

  constructor(
    message: string,
    init: {
      status: number;
      code?: number;
      rateLimited?: boolean;
      retryAfterMs?: number;
      retryable?: boolean;
      requestId?: string;
    },
  ) {
    super(message);
    this.name = 'TikTokApiError';
    this.status = init.status;
    this.code = init.code;
    this.rateLimited = Boolean(init.rateLimited);
    this.retryAfterMs = init.retryAfterMs;
    this.retryable = init.retryable ?? false;
    this.requestId = init.requestId;
  }
}

/** Business code TikTok returns when a call is throttled (alongside/instead of HTTP 429). */
export const RATE_LIMIT_CODE = 36009002;

const DEFAULT_TIMEOUT_MS = 15_000;

type Query = Record<string, string | number | undefined>;

export type ClientOptions = {
  config: TikTokConfig;
  fetch: FetchLike;
  accessToken?: string;
  shopCipher?: string;
  timeoutMs?: number;
  now?: () => number;
};

type Envelope<T> = { code?: number; message?: string; request_id?: string; data?: T };

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 15 * 60_000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 15 * 60_000));
  return undefined;
}

export class TikTokClient {
  private readonly config: TikTokConfig;
  private readonly fetchImpl: FetchLike;
  private readonly accessToken: string | undefined;
  private readonly shopCipher: string | undefined;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(options: ClientOptions) {
    this.config = options.config;
    this.fetchImpl = options.fetch;
    this.accessToken = options.accessToken;
    this.shopCipher = options.shopCipher;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  /** A signed, shop-scoped API call. */
  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: { query?: Query; body?: unknown; multipart?: FormData; shopScoped?: boolean } = {},
  ): Promise<T> {
    if (!this.accessToken) {
      throw new TikTokApiError('No TikTok Shop access token: the shop is not authorized', {
        status: 401,
      });
    }

    const query: Query = {
      ...(options.query ?? {}),
      app_key: this.config.appKey,
      timestamp: Math.floor(this.now() / 1000),
    };
    // `shop_cipher` is documented as required for cross-border shops and
    // optional for some local ones; sending it always is the safe reading.
    if (options.shopScoped !== false && this.shopCipher) query.shop_cipher = this.shopCipher;

    const isMultipart = Boolean(options.multipart);
    const body =
      !isMultipart && options.body !== undefined && method !== 'GET'
        ? JSON.stringify(options.body)
        : undefined;

    query.sign = signRequest({ path, query, body, appSecret: this.config.appSecret });

    const search = Object.keys(query)
      .filter((key) => query[key] !== undefined)
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(query[key]))}`)
      .join('&');

    const headers: Record<string, string> = { 'x-tts-access-token': this.accessToken };
    if (!isMultipart) headers['content-type'] = 'application/json';

    return this.send<T>(`${this.config.apiBaseUrl}${path}?${search}`, {
      method,
      headers,
      body: isMultipart ? options.multipart : body,
    });
  }

  private async send<T>(
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: unknown },
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      const aborted = (error as { name?: string })?.name === 'AbortError';
      throw new TikTokApiError(
        aborted ? `TikTok Shop did not answer within ${this.timeoutMs}ms` : 'Network error calling TikTok Shop',
        { status: 0, retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let envelope: Envelope<T> = {};
    try {
      envelope = text ? (JSON.parse(text) as Envelope<T>) : {};
    } catch {
      // A non-JSON body is an infrastructure answer (gateway page), not an API one.
    }

    const code = typeof envelope.code === 'number' ? envelope.code : undefined;
    const rateLimited = response.status === 429 || code === RATE_LIMIT_CODE;

    if (rateLimited) {
      throw new TikTokApiError('TikTok Shop rate limit reached', {
        status: response.status,
        code,
        rateLimited: true,
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        retryable: true,
        requestId: envelope.request_id,
      });
    }

    if (!response.ok || (code !== undefined && code !== 0)) {
      throw new TikTokApiError(
        `TikTok Shop error${code !== undefined ? ` ${code}` : ''}: ${envelope.message ?? `HTTP ${response.status}`}`,
        {
          status: response.status,
          code,
          // 5xx and gateway failures may pass on retry; a 4xx business error will not.
          retryable: response.status >= 500 || response.status === 0,
          requestId: envelope.request_id,
        },
      );
    }

    return (envelope.data ?? ({} as T)) as T;
  }

  // ── Authorization (not signed; app credentials in the query) ──────────────

  /**
   * Exchange the one-time `code` from the seller authorization redirect.
   * The grant type is `authorized_code` — `authorization_code` is rejected.
   */
  async exchangeAuthCode(authCode: string): Promise<TikTokTokenSet> {
    return this.tokenCall('/api/v2/token/get', {
      auth_code: authCode,
      grant_type: 'authorized_code',
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<TikTokTokenSet> {
    return this.tokenCall('/api/v2/token/refresh', {
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
  }

  private async tokenCall(path: string, params: Record<string, string>): Promise<TikTokTokenSet> {
    const query: Record<string, string> = {
      app_key: this.config.appKey,
      app_secret: this.config.appSecret,
      ...params,
    };
    const search = Object.keys(query)
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key] as string)}`)
      .join('&');

    const data = await this.send<{
      access_token?: string;
      refresh_token?: string;
      access_token_expire_in?: number;
      refresh_token_expire_in?: number;
      seller_name?: string;
    }>(`${this.config.authBaseUrl}${path}?${search}`, { method: 'GET' });

    if (!data.access_token || !data.refresh_token) {
      throw new TikTokApiError('TikTok Shop returned no token', { status: 502 });
    }

    // Both expiries are Unix timestamps (seconds), not durations.
    const toIso = (seconds: number | undefined) =>
      typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accessTokenExpiresAt: toIso(data.access_token_expire_in),
      refreshTokenExpiresAt: toIso(data.refresh_token_expire_in),
      sellerName: data.seller_name,
    };
  }

  // ── Shops ─────────────────────────────────────────────────────────────────

  async getAuthorizedShops(): Promise<TikTokShop[]> {
    const data = await this.request<{
      shops?: { id?: string; name?: string; region?: string; seller_type?: string; cipher?: string }[];
    }>('GET', '/authorization/202309/shops', { shopScoped: false });

    return (data.shops ?? [])
      .filter((shop) => shop.id && shop.cipher)
      .map((shop) => ({
        id: String(shop.id),
        name: shop.name ?? '',
        region: shop.region ?? '',
        sellerType: shop.seller_type ?? '',
        cipher: String(shop.cipher),
      }));
  }

  // ── Products ──────────────────────────────────────────────────────────────

  async getWarehouses(): Promise<{ id: string; isDefault: boolean; type: string }[]> {
    const data = await this.request<{
      warehouses?: { id?: string; is_default?: boolean; type?: string; effect_status?: string }[];
    }>('GET', '/logistics/202309/warehouses');
    return (data.warehouses ?? [])
      .filter((w) => w.id)
      .map((w) => ({ id: String(w.id), isDefault: Boolean(w.is_default), type: w.type ?? '' }));
  }

  async uploadProductImage(bytes: Uint8Array, filename: string, useCase = 'MAIN_IMAGE'): Promise<string> {
    const form = new FormData();
    form.append('data', new Blob([Buffer.from(bytes)]), filename);
    form.append('use_case', useCase);
    const data = await this.request<{ uri?: string }>('POST', '/product/202309/images/upload', {
      multipart: form,
      shopScoped: false,
    });
    if (!data.uri) throw new TikTokApiError('Image upload returned no uri', { status: 502 });
    return data.uri;
  }

  async createProduct(payload: unknown): Promise<{ productId: string; skus: { id: string; sellerSku: string }[] }> {
    const data = await this.request<{
      product_id?: string;
      skus?: { id?: string; seller_sku?: string }[];
    }>('POST', '/product/202309/products', { body: payload });
    if (!data.product_id) throw new TikTokApiError('Create product returned no product_id', { status: 502 });
    return {
      productId: String(data.product_id),
      skus: (data.skus ?? []).map((sku) => ({ id: String(sku.id ?? ''), sellerSku: sku.seller_sku ?? '' })),
    };
  }

  async editProduct(productId: string, payload: unknown, version = '202309'): Promise<{ skus: { id: string; sellerSku: string }[] }> {
    const data = await this.request<{ skus?: { id?: string; seller_sku?: string }[] }>(
      'PUT',
      `/product/${version}/products/${encodeURIComponent(productId)}`,
      { body: payload },
    );
    return {
      skus: (data.skus ?? []).map((sku) => ({ id: String(sku.id ?? ''), sellerSku: sku.seller_sku ?? '' })),
    };
  }

  async updatePrice(productId: string, payload: unknown): Promise<void> {
    await this.request('POST', `/product/202309/products/${encodeURIComponent(productId)}/prices/update`, {
      body: payload,
    });
  }

  async updateInventory(productId: string, payload: unknown): Promise<void> {
    await this.request('POST', `/product/202309/products/${encodeURIComponent(productId)}/inventory/update`, {
      body: payload,
    });
  }

  async setProductsActive(productIds: string[], active: boolean): Promise<void> {
    await this.request('POST', `/product/202309/products/${active ? 'activate' : 'deactivate'}`, {
      body: { product_ids: productIds },
    });
  }

  // ── Orders and fulfilment ─────────────────────────────────────────────────

  async searchOrders(
    filter: { updateTimeGe?: number; orderStatus?: string },
    page: { pageSize?: number; pageToken?: string } = {},
  ): Promise<{ orders: Record<string, unknown>[]; nextPageToken?: string }> {
    const body: Record<string, unknown> = {};
    if (filter.updateTimeGe) body.update_time_ge = filter.updateTimeGe;
    if (filter.orderStatus) body.order_status = filter.orderStatus;
    const data = await this.request<{ orders?: Record<string, unknown>[]; next_page_token?: string }>(
      'POST',
      '/order/202309/orders/search',
      { query: { page_size: page.pageSize ?? 50, page_token: page.pageToken }, body },
    );
    return { orders: data.orders ?? [], nextPageToken: data.next_page_token || undefined };
  }

  async getOrders(ids: string[], version = '202309'): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ orders?: Record<string, unknown>[] }>('GET', `/order/${version}/orders`, {
      query: { ids: ids.join(',') },
    });
    return data.orders ?? [];
  }

  /** Seller-shipped fulfilment: report the carrier and tracking number. */
  async markOrderShipped(
    orderId: string,
    input: { trackingNumber: string; shippingProviderId: string },
    version = '202309',
  ): Promise<void> {
    await this.request('POST', `/fulfillment/${version}/orders/${encodeURIComponent(orderId)}/packages`, {
      body: { tracking_number: input.trackingNumber, shipping_provider_id: input.shippingProviderId },
    });
  }
}
