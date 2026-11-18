'use client';

import { usePathname } from 'next/navigation';
import { AdminProvider } from './admin-context';
import { Shell } from './shell';
import { adminLocation } from '@/lib/admin-path';

// the sign in page and print posters go without the frame
export function AdminFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // the super admin screens bring their own frame (components/platform/platform-shell.tsx)
  const section = adminLocation(pathname).section;
  const bare = pathname === '/admin/login' || pathname === '/admin/forgot' || pathname.startsWith('/admin/reset/') || section.startsWith('/admin/print') || pathname.startsWith('/admin/platform');
  return <AdminProvider>{bare ? children : <Shell>{children}</Shell>}</AdminProvider>;
}
