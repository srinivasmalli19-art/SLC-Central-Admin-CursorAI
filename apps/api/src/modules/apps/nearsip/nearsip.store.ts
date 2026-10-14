import { config } from '../../../config/env.js';
import { AppError } from '../../../errors/AppError.js';
import { logger } from '../../../lib/logger.js';

/**
 * NearSip data access through Supabase's REST APIs (PostgREST for tables,
 * GoTrue admin for accounts) with the project's service-role key. The key
 * bypasses row-level security, so it lives only in Central Admin's server
 * environment and every call is authorised by Central Admin first.
 */

export const NEARSIP_CLIENT_ID = 'nearsip-admin';

/** Columns an admin may set on a place (mirrors NearSip's old admin form). */
export const PLACE_FIELDS = ['name', 'type', 'address', 'latitude', 'longitude', 'rating', 'is_hotspot', 'is_verified', 'is_popular'] as const;
export type PlaceInput = Partial<Record<(typeof PLACE_FIELDS)[number], string | number | boolean | null>>;
export type Row = Record<string, unknown>;

const TIMEOUT_MS = 10_000;

function requireNearSip(): { url: string; serviceRoleKey: string } {
  if (!config.nearsip) {
    throw new AppError(503, 'APP_NOT_CONNECTED', 'NearSip is not connected (no Supabase service-role key configured).');
  }
  return config.nearsip;
}

async function call<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT' | 'HEAD',
  path: string,
  init: { body?: unknown; prefer?: string } = {},
): Promise<{ data: T; count: number | null }> {
  const { url, serviceRoleKey } = requireNearSip();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'nearsip_unreachable');
    throw new AppError(502, 'APP_UNREACHABLE', 'NearSip could not be reached.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.warn({ status: res.status, path: path.split('?')[0], detail: detail.slice(0, 300) }, 'nearsip_request_failed');
    throw new AppError(res.status === 404 ? 404 : 502, res.status === 404 ? 'NOT_FOUND' : 'APP_ERROR', 'NearSip rejected the request.');
  }
  const range = res.headers.get('content-range'); // e.g. "0-24/312"
  const count = range && range.includes('/') ? Number(range.split('/')[1]) : null;
  const text = method === 'HEAD' ? '' : await res.text();
  return { data: (text ? JSON.parse(text) : undefined) as T, count: Number.isFinite(count) ? count : null };
}

const enc = encodeURIComponent;

export interface NearSipStore {
  summary(): Promise<{ places: number; reviews: number; users: number }>;
  listPlaces(q: { search?: string; limit: number; offset: number }): Promise<{ items: Row[]; total: number | null }>;
  createPlace(input: PlaceInput): Promise<Row>;
  updatePlace(id: string, input: PlaceInput): Promise<Row | null>;
  deletePlace(id: string): Promise<boolean>;
  listReviews(q: { limit: number; offset: number }): Promise<{ items: Row[]; total: number | null }>;
  deleteReview(id: string): Promise<boolean>;
  listUsers(q: { limit: number; offset: number }): Promise<{ items: Row[]; total: number | null }>;
  setUserDisabled(id: string, disabled: boolean): Promise<void>;
}

export class SupabaseNearSipStore implements NearSipStore {
  private async count(table: string): Promise<number> {
    const { count } = await call('HEAD', `/rest/v1/${table}?select=id`, { prefer: 'count=exact' });
    return count ?? 0;
  }

  async summary() {
    const [places, reviews, users] = await Promise.all([this.count('places'), this.count('reviews'), this.count('profiles')]);
    return { places, reviews, users };
  }

  async listPlaces(q: { search?: string; limit: number; offset: number }) {
    const filter = q.search ? `&name=ilike.${enc(`*${q.search.replace(/[*,()]/g, ' ')}*`)}` : '';
    const { data, count } = await call<Row[]>(
      'GET',
      `/rest/v1/places?select=*&order=name.asc&limit=${q.limit}&offset=${q.offset}${filter}`,
      { prefer: 'count=exact' },
    );
    return { items: data, total: count };
  }

  async createPlace(input: PlaceInput) {
    const { data } = await call<Row[]>('POST', '/rest/v1/places', { body: input, prefer: 'return=representation' });
    return data[0]!;
  }

  async updatePlace(id: string, input: PlaceInput) {
    const { data } = await call<Row[]>('PATCH', `/rest/v1/places?id=eq.${enc(id)}`, { body: input, prefer: 'return=representation' });
    return data[0] ?? null;
  }

  async deletePlace(id: string) {
    const { data } = await call<Row[]>('DELETE', `/rest/v1/places?id=eq.${enc(id)}`, { prefer: 'return=representation' });
    return data.length > 0;
  }

  async listReviews(q: { limit: number; offset: number }) {
    const { data, count } = await call<Row[]>(
      'GET',
      `/rest/v1/reviews?select=*&order=created_at.desc&limit=${q.limit}&offset=${q.offset}`,
      { prefer: 'count=exact' },
    );
    return { items: data, total: count };
  }

  async deleteReview(id: string) {
    const { data } = await call<Row[]>('DELETE', `/rest/v1/reviews?id=eq.${enc(id)}`, { prefer: 'return=representation' });
    return data.length > 0;
  }

  async listUsers(q: { limit: number; offset: number }) {
    const { data, count } = await call<Row[]>(
      'GET',
      `/rest/v1/profiles?select=*&order=created_at.desc&limit=${q.limit}&offset=${q.offset}`,
      { prefer: 'count=exact' },
    );
    return { items: data, total: count };
  }

  async setUserDisabled(id: string, disabled: boolean) {
    // Ban (reversible) rather than delete; banned users cannot sign in or refresh.
    await call('PUT', `/auth/v1/admin/users/${enc(id)}`, { body: { ban_duration: disabled ? '876000h' : 'none' } });
  }
}
