'use client';

// a list that comes in pages: the first page through useAsync, then more pages on demand. a page
// that arrives after the filters changed is dropped, so stale results never mix with fresh ones.
// one page at a time; a page that failed is not retried by itself (the button stays for a retry).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Page } from '@custock/core';
import { useAsync } from './use-async';

interface More<T> { key: string; items: T[]; next: string | null | undefined; busy: boolean; failed: boolean }

export function usePaged<T>(load: (cursor: string | undefined) => Promise<Page<T>>, deps: unknown[]) {
  const key = JSON.stringify(deps);
  const first = useAsync(() => load(undefined), deps);
  const [more, setMore] = useState<More<T>>({ key, items: [], next: undefined, busy: false, failed: false });
  const cur: More<T> = useMemo(() => (more.key === key ? more : { key, items: [], next: undefined, busy: false, failed: false }), [more, key]);
  const next = cur.next === undefined ? first.data?.nextCursor ?? null : cur.next;
  const items = useMemo(() => (first.data ? (cur.items.length ? [...first.data.items, ...cur.items] : first.data.items) : undefined), [first.data, cur.items]);

  // the latest of everything, so the loaders below keep one identity and never run twice at once
  const live = useRef({ load, key, next, cur, firstCount: 0 });
  useEffect(() => { live.current = { load, key, next, cur, firstCount: first.data?.items.length ?? 0 }; });
  const inflight = useRef(false);

  const loadMore = useCallback(async () => {
    const { next: from, cur: was, key: forKey, load: get } = live.current;
    if (!from || inflight.current) return;
    inflight.current = true;
    setMore({ ...was, busy: true, failed: false });
    try {
      const page = await get(from);
      if (live.current.key !== forKey) return;
      setMore((m) => ({ key: forKey, items: [...(m.key === forKey ? m.items : []), ...page.items], next: page.nextCursor, busy: false, failed: false }));
    } catch {
      if (live.current.key === forKey) setMore((m) => ({ ...m, key: forKey, busy: false, failed: true }));
    } finally {
      inflight.current = false;
    }
  }, []);

  // every remaining page, for sorting the whole list by a column. stops at `cap` items
  const loadAll = useCallback(async (cap = 5000) => {
    const { next: from, cur: was, key: forKey, load: get, firstCount } = live.current;
    if (!from || inflight.current) return;
    inflight.current = true;
    let cursor: string | null = from;
    let failed = false;
    const got: T[] = [...was.items];
    setMore({ ...was, busy: true, failed: false });
    try {
      while (cursor && live.current.key === forKey && firstCount + got.length < cap) {
        const page: Page<T> | null = await get(cursor).catch(() => null);
        if (!page) { failed = true; break; }
        got.push(...page.items);
        cursor = page.nextCursor;
      }
    } finally {
      inflight.current = false;
    }
    if (live.current.key === forKey) setMore({ key: forKey, items: got, next: cursor ?? null, busy: false, failed });
  }, []);

  const { reload: reloadFirst } = first;
  const reload = useCallback(async () => {
    setMore({ key: live.current.key, items: [], next: undefined, busy: false, failed: false });
    await reloadFirst();
  }, [reloadFirst]);

  return {
    items, data: first.data, loading: first.loading, error: first.error, hasMore: !!next, busy: cur.busy, failed: cur.failed,
    loadMore, loadAll, reload, setFirst: first.setData,
    // what <MoreRows> needs
    more: { hasMore: !!next, busy: cur.busy, failed: cur.failed, onMore: loadMore },
  };
}
