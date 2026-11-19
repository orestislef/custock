'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface State<T> { data: T | undefined; error: unknown; key: string | null }

// away this long (another app, a locked phone) and a read page loads again when it comes back
const STALE_AFTER_MS = 20_000;

// tiny loader: data, error, loading and a reload. keeps the old data while reloading,
// so lists do not flash empty when a filter changes.
// refreshOnReturn: for pages that only show things (no form being typed into). when the page comes
// back after a while it loads again quietly, without a skeleton, so a post approved meanwhile or
// a transfer that arrived shows as it is now.
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], opts?: { refreshOnReturn?: boolean }) {
  const [tick, setTick] = useState(0);
  // the inputs as a string (they are ids, filters and flags), so we know which load is current
  const key = `${JSON.stringify(deps)}|${tick}`;
  const [state, setState] = useState<State<T>>({ data: undefined, error: null, key: null });
  const latest = useRef({ fn, key });
  useEffect(() => { latest.current = { fn, key }; });

  useEffect(() => {
    let alive = true;
    fn().then(
      (data) => { if (alive) setState({ data, error: null, key }); },
      (error: unknown) => { if (alive) setState((s) => ({ ...s, error, key })); },
    );
    return () => { alive = false; };
    // fn is recreated every render, the key carries the real inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const refreshOnReturn = !!opts?.refreshOnReturn;
  useEffect(() => {
    if (!refreshOnReturn) return;
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    const quiet = () => {
      const { fn: load, key: at } = latest.current;
      // a failed quiet load keeps what is on screen
      load().then((data) => setState((s) => (s.key === at ? { data, error: null, key: at } : s)), () => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt !== null && Date.now() - hiddenAt >= STALE_AFTER_MS) quiet();
      hiddenAt = null;
    };
    // back from the browser's page cache (the back button) counts as coming back
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) quiet(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [refreshOnReturn]);

  const reload = useCallback(async () => { setTick((x) => x + 1); }, []);
  const setData = useCallback((next: T | undefined | ((cur: T | undefined) => T | undefined)) => {
    setState((s) => ({ ...s, data: typeof next === 'function' ? (next as (cur: T | undefined) => T | undefined)(s.data) : next }));
  }, []);

  return { data: state.data, error: state.error, loading: state.key !== key, reload, setData };
}
