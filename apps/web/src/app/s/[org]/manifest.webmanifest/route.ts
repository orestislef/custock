import { colors } from '@custock/tokens';
import { translator } from '@custock/i18n';
import { getLocale } from '@/lib/i18n-server';
import { orgInfo } from '@/lib/storefront';
import { iconVersion, orgIconPath } from '@/lib/manifests';

// each business is its own home screen app for its customers: its name, its icon, its pages
export async function GET(_req: Request, { params }: RouteContext<'/s/[org]/manifest.webmanifest'>) {
  const { org } = await params;
  const locale = await getLocale();
  const t = translator(locale, 'web');
  const info = await orgInfo(org, locale);
  if (info.missing) return new Response('Not found', { status: 404 });
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const home = `${base}/s/${encodeURIComponent(org)}`;
  const v = iconVersion(info.name, info.logoUrl);
  return Response.json(
    {
      id: home,
      name: info.name,
      short_name: info.name.length > 12 ? info.name.split(/\s+/)[0]!.slice(0, 12) : info.name,
      description: t('pwa.orgDescription', { org: info.name }),
      lang: locale,
      dir: 'ltr',
      start_url: home,
      scope: home,
      display: 'standalone',
      orientation: 'portrait',
      background_color: colors.light.shelf,
      theme_color: colors.light.shelf,
      icons: [
        { src: orgIconPath(org, 192, v), sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: orgIconPath(org, 512, v), sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: orgIconPath(org, 512, v, true), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=300' } },
  );
}
