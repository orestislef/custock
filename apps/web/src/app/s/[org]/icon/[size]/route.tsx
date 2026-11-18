import { orgInfo } from '@/lib/storefront';
import { logoIcon, monogram } from '@/lib/monogram';

// icons for the business's home screen app: /s/<org>/icon/180 (ios), /192, /512 and /512?maskable=1
export async function GET(req: Request, { params }: RouteContext<'/s/[org]/icon/[size]'>) {
  const { org, size } = await params;
  const px = size === '512' ? 512 : size === '180' ? 180 : 192;
  const info = await orgInfo(org);
  const maskable = new URL(req.url).searchParams.has('maskable');
  // the business's own logo when it set one, its first letter otherwise
  return info.logoUrl ? logoIcon(info.logoUrl, info.name, px, maskable) : monogram(info.name, px, maskable);
}
