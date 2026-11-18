'use client';

// a screen this person cannot use at all: back to Home, without a word about it. the navigation
// never links here for them, this only catches an old link or a typed address.

import { useEffect } from 'react';
import { useOrgRouter as useRouter } from '@/components/admin/org-link';

export function RedirectHome({ to = '/admin' }: { to?: string } = {}) {
  const router = useRouter();
  useEffect(() => { router.replace(to); }, [router, to]);
  return null;
}
