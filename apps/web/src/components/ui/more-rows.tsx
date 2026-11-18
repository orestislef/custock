'use client';

// the end of a long list: loads the next page when it scrolls into view, and stays a real button
// for keyboards, screen readers and slow connections. after a failed page it waits for a tap.
import { useEffect, useRef } from 'react';
import { useT } from '@/lib/i18n-client';

export function MoreRows({ hasMore, busy, failed, onMore, className }: { hasMore: boolean; busy: boolean; failed?: boolean; onMore: () => void; className?: string }) {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  // made again after each page, so a list that still ends on screen keeps loading
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || busy || failed || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) onMore(); }, { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, busy, failed, onMore]);
  if (!hasMore) return null;
  return (
    <div className={className ?? 'flex justify-center py-3'}>
      <button ref={ref} type="button" className="btn btn-plain min-h-[44px]" onClick={onMore} disabled={busy} aria-busy={busy}>
        {busy ? t('list.loading') : t('list.more')}
      </button>
    </div>
  );
}
