'use client';

import { usePathname } from 'next/navigation';
import { AdminProvider } from './admin-context';
import { Shell } from './shell';

// the sign in page and print posters go without the frame
export function AdminFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = pathname === '/admin/login' || pathname.startsWith('/admin/print');
  return <AdminProvider>{bare ? children : <Shell>{children}</Shell>}</AdminProvider>;
}
