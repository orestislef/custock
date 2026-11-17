import Link from 'next/link';
import { getT } from '@/lib/i18n-server';
import { serverApi } from '@/lib/api-server';
import { Group, Row, IconTile } from '@/components/ui/kit';
import { LocaleSwitch } from '@/components/ui/client-kit';
import { IconBarcode, IconBox, IconGear, IconQr, IconTag } from '@/components/ui/icons';

// a small front door for local development: the admin, and the pages a customer reaches by QR
export default async function Home() {
  const { t, locale } = await getT();
  const { mode } = await serverApi(locale);
  return (
    <main className="mx-auto max-w-[560px] px-4 pt-[calc(56px+env(safe-area-inset-top))] pb-12 page-in">
      <div className="flex items-center justify-between mb-8">
        <span className="badge badge-gray">{t(mode === 'real' ? 'home.modeReal' : 'home.modeFixtures')}</span>
        <LocaleSwitch />
      </div>
      <h1 className="t-large t-display m-0">Custock</h1>
      <p className="t-title3 t-2 mt-2 mb-8" style={{ fontWeight: 400 }}>{t('common:app.tagline')}</p>

      <Group title={t('home.forTeams')}>
        <Row href="/admin" leading={<IconTile><IconGear size={18} /></IconTile>} title={t('home.admin')} subtitle={t('home.adminSub')} />
      </Group>
      <Group title={t('home.forCustomers')} footer={t('home.customersFoot')}>
        <Row href="/j/kif7q2" leading={<IconTile><IconQr size={18} /></IconTile>} title={t('home.join')} subtitle="/j/kif7q2" />
        <Row href="/p/5200044170102" leading={<IconTile><IconBarcode size={18} /></IconTile>} title={t('home.shelf')} subtitle="/p/5200044170102" />
        <Row href="/s/lemoni" leading={<IconTile><IconBox size={18} /></IconTile>} title={t('home.catalog')} subtitle="/s/lemoni" />
        <Row href="/s/lemoni/offers" leading={<IconTile><IconTag size={18} /></IconTile>} title={t('home.offers')} subtitle="/s/lemoni/offers" />
      </Group>
      <p className="t-foot t-2 text-center"><Link href="https://github.com/orestislef/custock">github.com/orestislef/custock</Link></p>
    </main>
  );
}
