// the demo's front page, copied over src/app/page.tsx by scripts/build-demo.mjs (demo copy only).
// the way in: the sample team on the sign in page, and the pages a customer reaches.
import type { Metadata } from 'next';
import { Group, Row, IconTile } from '@/components/ui/kit';
import { LocaleSwitch } from '@/components/ui/client-kit';
import { IconBarcode, IconBox, IconPeople, IconQr, IconShield, IconTag } from '@/components/ui/icons';
import { demoRouteIds } from '@/lib/fixtures';

export const metadata: Metadata = { title: { absolute: 'Custock demo' }, description: 'The Custock app with made up data. Nothing is sent anywhere.' };

export default function DemoStart() {
  const ids = demoRouteIds();
  const shelf = ids.productCodes[0] ?? '';
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return (
    <main className="mx-auto max-w-[560px] px-safe-4 pt-[calc(56px+env(safe-area-inset-top))] pb-12 page-in">
      <div className="flex items-center justify-between mb-8">
        <span className="badge badge-gray">Demo</span>
        <LocaleSwitch />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${base}/icons/icon-192.png`} alt="" width={64} height={64} className="mb-5" style={{ borderRadius: 14, boxShadow: '0 0 0 0.5px var(--c-line)' }} />
      <h1 className="t-large t-display m-0">Custock</h1>
      <p className="t-title3 t-2 mt-2 mb-3" style={{ fontWeight: 400 }}>Stock and customers for shops, in one app on the phone.</p>
      <p className="t-sub t-2 mt-0 mb-8">
        This is the real app with a made up business, Lemoni, and three shops. Everything stays in this browser tab: nothing is sent,
        no email or notification goes out, and a reload starts over.
      </p>

      <Group title="Run a shop" footer="Each person has a different role, so you can see what the owner, a manager, staff or a viewer gets.">
        <Row href="/admin/login" leading={<IconTile><IconPeople size={18} /></IconTile>} title="Sign in as someone from the team" subtitle="Owner, admin, manager, staff or viewer" />
      </Group>

      <Group title="Be a customer" footer="Sign in there with any email: the code shows on screen instead of being emailed.">
        <Row href="/s/lemoni" leading={<IconTile><IconBox size={18} /></IconTile>} title="The shop's app" subtitle="Catalog, offers, news and notify me" />
        <Row href="/s/lemoni/offers" leading={<IconTile><IconTag size={18} /></IconTile>} title="Offers" />
        <Row href="/j/kif7q2" leading={<IconTile><IconQr size={18} /></IconTile>} title="Join from a QR poster" subtitle="What a customer sees after scanning the shop's poster" />
        {shelf ? <Row href={`/p/${shelf}`} leading={<IconTile><IconBarcode size={18} /></IconTile>} title="A shelf label's QR code" subtitle="The product page it opens" /> : null}
      </Group>

      <Group footer="The super admin area, for whoever runs Custock itself, is not part of the demo.">
        <Row href="https://github.com/orestislef/custock" leading={<IconTile><IconShield size={18} /></IconTile>} title="Source on GitHub" />
        <Row href="https://github.com/orestislef/custock/blob/main/demo/CREDITS.md" leading={<IconTile><IconTag size={18} /></IconTile>} title="Photo credits" subtitle="Free licensed photos from Wikimedia Commons and Flickr" />
      </Group>
    </main>
  );
}
