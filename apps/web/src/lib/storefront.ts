import 'server-only';

// what a visitor without an account may see of a business, read on the server. the shared client's
// catalog() is the signed in one (/v1/c/...), so the public catalog is read here directly.

import type { PublicProduct } from '@custock/core';
import { cache } from 'react';
import { forwarded, serverApi } from './api-server';
import { defaultJoinCode, devBuild } from './env';
import { DEFAULT_TIME_ZONE } from './format';

const apiUrl = () => (process.env.CUSTOCK_API_URL?.replace(/\/$/, '') || (process.env.NODE_ENV === 'production' ? 'http://127.0.0.1:8787' : null));

async function forwardedHeaders(locale?: string): Promise<Record<string, string>> {
  return { Accept: 'application/json', ...(locale ? { 'Accept-Language': locale } : {}), ...((await forwarded()) ?? {}) };
}

// null when the business shows its catalog to followers only (or not at all). one fetch per request
export function publicCatalog(slug: string, opts: { q?: string; locale?: string } = {}): Promise<PublicProduct[] | null> {
  return catalogOnce(slug, opts.q ?? '', opts.locale ?? '');
}

const catalogOnce = cache(async (slug: string, q: string, locale: string): Promise<PublicProduct[] | null> => {
  const opts = { q: q || undefined, locale: locale || undefined };
  const { api, mode } = await serverApi(opts.locale);
  if (mode === 'fixtures') return api.catalog(slug, opts.q ? { q: opts.q } : undefined).catch(() => null);
  const base = apiUrl();
  if (!base) return null;
  const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
  try {
    const res = await fetch(`${base}/v1/public/orgs/${encodeURIComponent(slug)}/catalog${qs}`, { headers: await forwardedHeaders(opts.locale), cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as PublicProduct[];
  } catch {
    return null;
  }
});

export async function publicProductById(slug: string, id: string, locale?: string): Promise<PublicProduct | null> {
  const all = await publicCatalog(slug, { locale });
  return all?.find((p) => p.id === id) ?? null;
}

export interface OrgInfo { slug: string; name: string; joinCode: string | null; catalogShared: boolean; logoUrl: string | null; timeZone: string; unavailable?: boolean }

interface PublicOrg { slug: string; name: string; catalog: string; joinCode: string | null; logoUrl?: string | null; timezone?: string; unavailable?: boolean }

// the business's name and its join link for the whole business, from the api. one fetch per request
const publicOrgOnce = cache(async (slug: string, locale: string): Promise<PublicOrg | null> => {
  const { mode } = await serverApi(locale || undefined);
  if (mode === 'fixtures') return null;
  const base = apiUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/v1/public/orgs/${encodeURIComponent(slug)}`, { headers: await forwardedHeaders(locale || undefined), cache: 'no-store' });
    // a paused business, or one whose customer pages are off: its pages say it is not available
    if (res.status === 403) {
      const code = ((await res.json().catch(() => null)) as { code?: string } | null)?.code;
      if (code === 'org_suspended' || code === 'feature_off') return { slug, name: slug, catalog: 'off', joinCode: null, unavailable: true };
    }
    return res.ok ? ((await res.json()) as PublicOrg) : null;
  } catch {
    return null;
  }
});

// the business name for frames, manifests and icons, and the way in for visitors. the api knows
// both; the sample business of local development falls back to its catalog and join page.
export async function orgInfo(slug: string, locale?: string): Promise<OrgInfo> {
  const items = await publicCatalog(slug, { locale });
  const pub = await publicOrgOnce(slug, locale ?? '');
  const joinCode = pub ? pub.joinCode : defaultJoinCode();
  let name = pub?.name ?? items?.[0]?.orgName ?? null;
  if (!name && joinCode && devBuild) {
    const { api } = await serverApi(locale);
    name = (await api.joinPage(joinCode).catch(() => null))?.orgName ?? null;
  }
  return { slug, name: name ?? slug.charAt(0).toUpperCase() + slug.slice(1), joinCode, catalogShared: items != null, logoUrl: pub?.logoUrl ?? null, timeZone: pub?.timezone || DEFAULT_TIME_ZONE, ...(pub?.unavailable ? { unavailable: true } : {}) };
}
