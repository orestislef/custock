'use client';

// a screen whose feature a super admin switched off for this business is simply not there: no menu
// item, no tab, no button, and a direct visit goes back home without a message.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Feature } from '@custock/core';

export function featureForRoute(pathname: string): Feature | null {
  if (pathname.startsWith('/admin/posts')) return 'posts';
  if (pathname.startsWith('/admin/reports')) return 'reports';
  if (pathname.startsWith('/admin/stock/counts')) return 'counts';
  if (pathname.startsWith('/admin/stock/transfers')) return 'transfers';
  return null;
}

export function GoHome() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin'); }, [router]);
  return null;
}
