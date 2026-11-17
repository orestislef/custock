'use client';

import { useCallback, useEffect, useState } from 'react';

interface State<T> { data: T | undefined; error: unknown; key: string | null }

// tiny loader: data, error, loading and a reload. keeps the old data while reloading,
// so lists do not flash empty when a filter changes.
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [tick, setTick] = useState(0);
  // the inputs as a string (they are ids, filters and flags), so we know which load is current
  const key = `${JSON.stringify(deps)}|${tick}`;
  const [state, setState] = useState<State<T>>({ data: undefined, error: null, key: null });

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

  const reload = useCallback(async () => { setTick((x) => x + 1); }, []);
  const setData = useCallback((next: T | undefined | ((cur: T | undefined) => T | undefined)) => {
    setState((s) => ({ ...s, data: typeof next === 'function' ? (next as (cur: T | undefined) => T | undefined)(s.data) : next }));
  }, []);

  return { data: state.data, error: state.error, loading: state.key !== key, reload, setData };
}
