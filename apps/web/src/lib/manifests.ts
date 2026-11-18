// the two kinds of home screen app, as metadata for the pages that belong to them

import type { Metadata } from 'next';

const base = () => process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// the custock icon, for every page that does not belong to a business
export function appIcons(): Metadata['icons'] {
  return { icon: [{ url: `${base()}/icons/favicon-64.png`, sizes: '64x64', type: 'image/png' }], apple: [{ url: `${base()}/icons/apple-touch-icon.png`, sizes: '180x180' }] };
}

export function staffAppMetadata(): Metadata {
  return { manifest: `${base()}/manifest.webmanifest`, icons: appIcons(), appleWebApp: { capable: true, title: 'Custock', statusBarStyle: 'default' } };
}

// a business's pages carry its own name and monogram icon to the home screen
export function orgAppMetadata(slug: string, name: string): Metadata {
  const home = `${base()}/s/${encodeURIComponent(slug)}`;
  return {
    manifest: `${home}/manifest.webmanifest`,
    icons: { icon: [{ url: `${home}/icon/192`, sizes: '192x192', type: 'image/png' }], apple: [{ url: `${home}/icon/180`, sizes: '180x180' }] },
    appleWebApp: { capable: true, title: name, statusBarStyle: 'default' },
  };
}
