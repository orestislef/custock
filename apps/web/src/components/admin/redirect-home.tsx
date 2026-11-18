'use client';

// a screen this person cannot use at all: back to Home, without a word about it. the navigation
// never links here for them, this only catches an old link or a typed address.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function RedirectHome() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin'); }, [router]);
  return null;
}
