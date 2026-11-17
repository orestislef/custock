'use client';

import { usePathname } from 'next/navigation';
import { AdminProvider } from '@/components/admin/admin-context';
import { Shell } from '@/components/admin/shell';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = pathname === '/admin/login' || pathname.startsWith('/admin/print');
  return <AdminProvider>{bare ? children : <Shell>{children}</Shell>}</AdminProvider>;
}
