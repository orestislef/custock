'use client';

import Link from 'next/link';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { ProductForm } from '@/components/admin/product-form';
import { Why } from '@/components/ui/kit';
import { IconChevronLeft } from '@/components/ui/icons';

export default function NewProductPage() {
  const { t, can } = useAdmin();
  return (
    <Page title={t('stock.newProduct')}>
      <Link href="/admin/stock" className="inline-flex items-center min-h-[44px] -ml-2 -mt-3 mb-3 t-body"><IconChevronLeft size={24} />{t('stock.title')}</Link>
      {can('products.create', null) ? <ProductForm /> : <Why>{t('common:error.forbidden')}</Why>}
    </Page>
  );
}
