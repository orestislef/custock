import type { Metadata } from 'next';
import { AdminFrame } from '@/components/admin/admin-frame';
import { staffAppMetadata } from '@/lib/manifests';

export const metadata: Metadata = { ...staffAppMetadata(), robots: { index: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminFrame>{children}</AdminFrame>;
}
