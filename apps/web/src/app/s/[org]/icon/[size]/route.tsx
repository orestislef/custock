import { orgInfo } from '@/lib/storefront';
import { logoIcon, monogram } from '@/lib/monogram';
import { iconVersion } from '@/lib/manifests';

// icons for the business's home screen app: /s/<org>/icon/180 (ios), /192, /512 and /512?maskable=1
//
// rendering an icon costs an api call, a logo download and an image render, and anyone can ask for
// one, so both steps are kept in memory: what the business looks like for a minute, and each
// rendered icon by business, size and logo version. other query parameters are ignored, so a
// random ?v= does not make new work.

type Info = Awaited<ReturnType<typeof orgInfo>>;
const INFO_TTL_MS = 60_000;
const MAX_INFOS = 500;
const MAX_ICONS = 300;
const infos = new Map<string, { at: number; info: Info }>();
const icons = new Map<string, { body: ArrayBuffer; type: string }>();

function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value as K);
}

async function infoOf(slug: string): Promise<Info> {
  const hit = infos.get(slug);
  if (hit && Date.now() - hit.at < INFO_TTL_MS) return hit.info;
  const info = await orgInfo(slug);
  remember(infos, slug, { at: Date.now(), info }, MAX_INFOS);
  return info;
}

export async function GET(req: Request, { params }: RouteContext<'/s/[org]/icon/[size]'>) {
  const { org, size } = await params;
  const px = size === '512' ? 512 : size === '180' ? 180 : 192;
  const url = new URL(req.url);
  const maskable = url.searchParams.has('maskable');
  const info = await infoOf(org);
  if (info.missing) return new Response('Not found', { status: 404 });
  const version = iconVersion(info.name, info.logoUrl);
  // a url with the current version never changes, so it may be kept for good. without it, or with
  // an old one, only for a few minutes, so a new logo shows up soon everywhere
  const cacheControl = url.searchParams.get('v') === version ? 'public, max-age=31536000, immutable' : 'public, max-age=300';
  const key = `${org}|${px}|${maskable ? 1 : 0}|${version}`;
  let icon = icons.get(key);
  if (!icon) {
    // the business's own logo when it set one, its first letter otherwise
    const res = info.logoUrl ? await logoIcon(info.logoUrl, info.name, px, maskable, cacheControl) : await monogram(info.name, px, maskable, cacheControl);
    icon = { body: await res.arrayBuffer(), type: res.headers.get('content-type') ?? 'image/png' };
    remember(icons, key, icon, MAX_ICONS);
  }
  return new Response(icon.body, { headers: { 'Content-Type': icon.type, 'Cache-Control': cacheControl } });
}
