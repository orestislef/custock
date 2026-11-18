// staff pages carry their business in the address: /admin/<slug>/stock/<id>. the pages themselves
// are written against the short form (/admin/stock/<id>), and orgPath() puts the business in. the
// old short addresses still open: the admin frame sends them on to the right business.

// sections of a business. a business slug can never be one of these (see RESERVED_SLUGS in core)
export const ADMIN_SECTIONS = [
  'stock', 'scan', 'customers', 'posts', 'reports', 'team', 'join-links', 'settings', 'audit', 'dev-outbox', 'print',
] as const;

// pages of the staff app that belong to no business
export const ADMIN_TOP = ['login', 'forgot', 'reset', 'platform'] as const;

const SECTIONS = new Set<string>(ADMIN_SECTIONS);
const TOP = new Set<string>(ADMIN_TOP);

function splitSuffix(path: string): [string, string] {
  const i = path.search(/[?#]/);
  return i === -1 ? [path, ''] : [path.slice(0, i), path.slice(i)];
}

// '/admin/stock/1?x' with slug 'lemoni' -> '/admin/lemoni/stock/1?x'. anything else stays as it is
export function orgPath(href: string, slug: string | null | undefined): string {
  if (!slug || !href.startsWith('/admin')) return href;
  const [path, suffix] = splitSuffix(href);
  if (path === '/admin' || path === '/admin/') return `/admin/${slug}${suffix}`;
  if (!path.startsWith('/admin/')) return href;
  const first = path.slice('/admin/'.length).split('/')[0] ?? '';
  if (!SECTIONS.has(first)) return href;
  return `/admin/${slug}${path.slice('/admin'.length)}${suffix}`;
}

export interface AdminLocation {
  // the business in the address, or null for top pages and the old short addresses
  slug: string | null;
  // the same page in the short form the code is written against ('/admin', '/admin/stock/1')
  section: string;
  // an old short address of a business page (/admin/stock/1) that has to be sent on
  legacy: boolean;
}

export function adminLocation(pathname: string): AdminLocation {
  if (pathname === '/admin' || pathname === '/admin/') return { slug: null, section: '/admin', legacy: false };
  if (!pathname.startsWith('/admin/')) return { slug: null, section: pathname, legacy: false };
  const rest = pathname.slice('/admin/'.length);
  const first = rest.split('/')[0] ?? '';
  if (TOP.has(first)) return { slug: null, section: pathname, legacy: false };
  if (SECTIONS.has(first)) return { slug: null, section: pathname, legacy: true };
  const after = rest.slice(first.length);
  return { slug: first, section: `/admin${after === '/' ? '' : after}`, legacy: false };
}
