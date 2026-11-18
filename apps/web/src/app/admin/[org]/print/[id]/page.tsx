'use client';

import Link from '@/components/admin/org-link';
import { use } from 'react';
import { translator } from '@custock/i18n';
import { useAdmin } from '@/components/admin/admin-context';
import { Qr } from '@/components/ui/qr';
import { IconChevronLeft, IconPrint } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { basePath } from '@/lib/api-client';

// an A4 poster for the shop window: the qr, the shop name and one line in each language,
// so greek, english and russian speaking customers all know what it is
export default function PosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, org, t, shops } = useAdmin();
  const links = useAsync(() => api.joinLinks(org.orgId), []);
  const l = links.data?.find((x) => x.id === id);
  if (!l) return <div className="p-10"><div className="h-[400px] skel" /></div>;
  const shop = l.scopeType === 'shop' ? shops.find((s) => s.id === l.scopeId)?.name : null;
  const url = `${window.location.origin}${basePath}${l.url}`;
  const lines = (['el', 'en', 'ru'] as const).map((lc) => translator(lc, 'web')('poster.line', { org: org.name }));

  return (
    <div className="min-h-dvh" style={{ background: 'var(--c-shelf)' }}>
      <div className="no-print flex items-center gap-2 px-4 h-[56px] max-w-[820px] mx-auto">
        <Link href="/admin/join-links" className="inline-flex items-center min-h-[44px] ml-back t-body"><IconChevronLeft size={24} />{t('links.title')}</Link>
        <span className="flex-1" />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}><IconPrint size={18} />{t('common:action.print')}</button>
      </div>
      <div className="mx-auto bg-white text-[#16171B] flex flex-col items-center text-center"
        style={{ width: 'min(210mm, 100%)', minHeight: '297mm', padding: '22mm 18mm', boxShadow: '0 10px 40px rgba(0,0,0,0.12)' }}>
        <p style={{ fontSize: 22, color: '#5E6068', margin: 0 }}>{org.name}</p>
        <h1 className="t-display" style={{ fontSize: 64, lineHeight: 1.05, margin: '6mm 0 12mm', fontWeight: 700, color: '#16171B' }}>{shop ?? org.name}</h1>
        <div style={{ padding: 8, border: '2px solid #B0234F', borderRadius: 20 }}><Qr value={url} size={300} label={url} /></div>
        <div style={{ marginTop: '14mm', display: 'flex', flexDirection: 'column', gap: '5mm' }}>
          {lines.map((line, i) => <p key={i} style={{ fontSize: i === 0 ? 26 : 20, margin: 0, color: i === 0 ? '#16171B' : '#5E6068', fontWeight: i === 0 ? 600 : 400 }}>{line}</p>)}
        </div>
        <span style={{ flex: 1 }} />
        <p style={{ fontSize: 13, color: '#8A8C93', margin: '12mm 0 0' }}>{url.replace(/^https?:\/\//, '')}</p>
      </div>
    </div>
  );
}
