// the two kinds of home screen app, as metadata for the pages that belong to them

import type { Metadata } from 'next';
import { iconVersion } from '@custock/core';

export { iconVersion };

const base = () => process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// the custock icon, for every page that does not belong to a business
export function appIcons(): Metadata['icons'] {
  return { icon: [{ url: `${base()}/icons/favicon-64.png`, sizes: '64x64', type: 'image/png' }], apple: [{ url: `${base()}/icons/apple-touch-icon.png`, sizes: '180x180' }] };
}

export function staffAppMetadata(): Metadata {
  return { manifest: `${base()}/manifest.webmanifest`, icons: appIcons(), appleWebApp: { capable: true, title: 'Custock', statusBarStyle: 'default' } };
}

export function orgIconPath(slug: string, size: 180 | 192 | 512, version: string, maskable = false): string {
  return `${base()}/s/${encodeURIComponent(slug)}/icon/${size}?v=${version}${maskable ? '&maskable=1' : ''}`;
}

// a business's pages carry its own name and icon (logo or monogram) to the home screen
export function orgAppMetadata(slug: string, name: string, logoUrl?: string | null): Metadata {
  const home = `${base()}/s/${encodeURIComponent(slug)}`;
  const v = iconVersion(name, logoUrl);
  return {
    manifest: `${home}/manifest.webmanifest?v=${v}`,
    icons: { icon: [{ url: orgIconPath(slug, 192, v), sizes: '192x192', type: 'image/png' }], apple: [{ url: orgIconPath(slug, 180, v), sizes: '180x180' }] },
    appleWebApp: { capable: true, title: name, statusBarStyle: 'default' },
  };
}
