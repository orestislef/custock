'use client';

// a quiet line on a form that came back from a draft, with a way to start from scratch

import { clearDraft } from '@/lib/draft';
import { useT } from '@/lib/i18n-client';

export function DraftNote({ draftKey }: { draftKey: string }) {
  const t = useT();
  return (
    <p className="t-foot t-2 flex items-center gap-2 flex-wrap mb-3 px-1" role="status">
      <span>{t('draft.restored')}</span>
      <button type="button" className="min-h-[44px] px-1" style={{ color: 'var(--c-accent)' }} onClick={() => { clearDraft(draftKey); window.location.reload(); }}>{t('draft.startOver')}</button>
    </p>
  );
}
