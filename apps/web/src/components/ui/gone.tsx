'use client';

// what a link lands on when its item is no longer there (a deleted post, an archived product, a
// cancelled transfer): one calm line and the way to the list it belonged to. never a 404 page.
// an item the person can no longer open at all sends them home without a word.

import Link from '@/components/admin/org-link';
import type { ReactNode } from 'react';
import { Empty } from './kit';
import { IconSearch } from './icons';
import { RedirectHome } from '@/components/admin/redirect-home';

export type Missing = 'gone' | 'closed' | null;

// what a failed load means for a page opened from a link
export function missingFrom(error: unknown): Missing {
  const e = error as { status?: number; code?: string } | null;
  if (!e) return null;
  if (e.status === 404 || e.status === 410 || e.code === 'not_found') return 'gone';
  if (e.status === 403 || e.code === 'forbidden') return 'closed';
  return null;
}

export function Gone({ title, body, href, cta, icon }: { title: ReactNode; body?: ReactNode; href: string; cta: ReactNode; icon?: ReactNode }) {
  return (
    <div className="page-in pt-10">
      <Empty icon={icon ?? <IconSearch size={28} />} title={title} body={body} action={<Link href={href} className="btn btn-tinted">{cta}</Link>} />
    </div>
  );
}

// the staff side: a gone item shows Gone, a closed one goes home quietly
export function StaffMissing({ kind, title, body, href, cta }: { kind: Missing; title: ReactNode; body?: ReactNode; href: string; cta: ReactNode }) {
  if (kind === 'closed') return <RedirectHome />;
  return <Gone title={title} body={body} href={href} cta={cta} />;
}
