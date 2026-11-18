import Link from 'next/link';
import type { ReactNode } from 'react';
import type { TFunction } from '@custock/i18n';
import { LocaleSwitch } from '@/components/ui/client-kit';
import { IconChevronLeft } from '@/components/ui/icons';

// the frame of every customer facing page: the business name, the language switch,
// the content, and a quiet footer. the business is the brand here, not us.
export function PublicShell({ orgName, t, children, back, logoUrl }: { orgName: string; t: TFunction; children: ReactNode; back?: { href: string; label: string }; logoUrl?: string | null }) {
  return (
    <div className="min-h-dvh flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="bar">
        <div className="mx-auto max-w-[680px] flex items-center gap-2 px-4 h-[52px]">
          {back ? (
            <Link href={back.href} className="t-body inline-flex items-center min-h-[44px] -ml-2 pr-2">
              <IconChevronLeft size={24} />
              {back.label}
            </Link>
          ) : (
            <span className="inline-flex items-center gap-2 min-w-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logoUrl ? <img src={logoUrl} alt="" width={28} height={28} className="flex-none rounded-[7px] object-contain" style={{ background: '#FFFFFF' }} /> : null}
              <span className="t-headline truncate">{orgName}</span>
            </span>
          )}
          <span className="flex-1" />
          <LocaleSwitch />
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-[680px] px-4 pt-4 pb-10 page-in">{children}</main>
      <footer className="mx-auto w-full max-w-[680px] px-4 pb-[calc(24px+env(safe-area-inset-bottom))] t-foot t-2 text-center">
        {t('public.footer', { org: orgName })}
      </footer>
    </div>
  );
}
