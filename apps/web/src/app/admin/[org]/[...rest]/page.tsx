'use client';

// old short addresses (/admin/stock/new, /admin/team/roles) land here, because their first part
// reads like a business. the admin frame sends them on to the same page in the right business.
// anything else under a real business that matches no page is not found.

import { notFound, usePathname } from 'next/navigation';
import { adminLocation } from '@/lib/admin-path';

export default function OldAddress() {
  const pathname = usePathname();
  if (!adminLocation(pathname).legacy) notFound();
  return null;
}
