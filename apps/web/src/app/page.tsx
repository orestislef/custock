import type { Metadata } from 'next';
import Link from 'next/link';
import { getT } from '@/lib/i18n-server';
import { serverApi } from '@/lib/api-server';
import { devBuild } from '@/lib/env';
import { staffAppMetadata } from '@/lib/manifests';
import { Group, Row, IconTile } from '@/components/ui/kit';
import { LocaleSwitch } from '@/components/ui/client-kit';
import { LandingCoach } from '@/components/pwa/landing-coach';
import { SessionGate } from '@/components/session-gate';
import { IconBarcode, IconBox, IconGear, IconPeople, IconQr, IconScan, IconTag } from '@/components/ui/icons';

export const metadata: Metadata = { ...staffAppMetadata() };

// the front door. on a server: what custock is and the way in for a team. while developing: the
// admin and the pages a customer reaches by QR, with the sample shop.
export default async function Home() {
  return devBuild ? <DevHome /> : <Landing />;
}

async function Landing() {
  const { t } = await getT();
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return (
    <main data-guest className="mx-auto max-w-[520px] px-safe-5 pt-[calc(28px+env(safe-area-inset-top))] pb-[calc(40px+env(safe-area-inset-bottom))] min-h-dvh flex flex-col page-in">
      <SessionGate />
      <div className="flex justify-end"><LocaleSwitch /></div>
      <div className="flex-1 flex flex-col justify-center py-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${base}/icons/icon-192.png`} alt="" width={72} height={72} className="mb-6" style={{ borderRadius: 16, boxShadow: '0 0 0 0.5px var(--c-line)' }} />
        <h1 className="t-large t-display m-0" style={{ fontSize: 40, lineHeight: '46px' }}>Custock</h1>
        <p className="t-title3 t-2 mt-2 mb-8" style={{ fontWeight: 400 }}>{t('landing.lead')}</p>
        <ul className="list mb-8" role="list">
          <li className="row has-icon"><span className="icon-tile"><IconScan size={18} /></span><span className="row-main"><span className="row-title block">{t('landing.scanTitle')}</span><span className="row-sub block">{t('landing.scanSub')}</span></span></li>
          <li className="row has-icon"><span className="icon-tile"><IconPeople size={18} /></span><span className="row-main"><span className="row-title block">{t('landing.peopleTitle')}</span><span className="row-sub block">{t('landing.peopleSub')}</span></span></li>
          <li className="row has-icon"><span className="icon-tile"><IconTag size={18} /></span><span className="row-main"><span className="row-title block">{t('landing.offersTitle')}</span><span className="row-sub block">{t('landing.offersSub')}</span></span></li>
        </ul>
        <Link href="/admin/login" className="btn btn-primary btn-large">{t('landing.signIn')}</Link>
        <p className="t-foot t-2 text-center mt-4 mb-0">{t('landing.inviteOnly')}</p>
        <LandingCoach />
      </div>
    </main>
  );
}

async function DevHome() {
  const { t, locale } = await getT();
  const { mode } = await serverApi(locale);
  return (
    <main className="mx-auto max-w-[560px] px-safe-4 pt-[calc(56px+env(safe-area-inset-top))] pb-12 page-in">
      <div className="flex items-center justify-between mb-8">
        <span className="badge badge-gray">{t(mode === 'real' ? 'home.modeReal' : 'home.modeFixtures')}</span>
        <LocaleSwitch />
      </div>
      <h1 className="t-large t-display m-0">Custock</h1>
      <p className="t-title3 t-2 mt-2 mb-8" style={{ fontWeight: 400 }}>{t('common:app.tagline')}</p>

      <Group title={t('home.forTeams')}>
        <Row href="/admin" leading={<IconTile><IconGear size={18} /></IconTile>} title={t('home.admin')} subtitle={t('home.adminSub')} />
        <Row href="/admin/scan" leading={<IconTile><IconScan size={18} /></IconTile>} title={t('home.scan')} subtitle="/admin/scan" />
      </Group>
      <Group title={t('home.forCustomers')} footer={t('home.customersFoot')}>
        <Row href="/j/kif7q2" leading={<IconTile><IconQr size={18} /></IconTile>} title={t('home.join')} subtitle="/j/kif7q2" />
        <Row href="/p/5200044170102" leading={<IconTile><IconBarcode size={18} /></IconTile>} title={t('home.shelf')} subtitle="/p/5200044170102" />
        <Row href="/s/lemoni" leading={<IconTile><IconBox size={18} /></IconTile>} title={t('home.catalog')} subtitle="/s/lemoni" />
        <Row href="/s/lemoni/offers" leading={<IconTile><IconTag size={18} /></IconTile>} title={t('home.offers')} subtitle="/s/lemoni/offers" />
      </Group>
    </main>
  );
}
