'use client';

import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { ProductForm } from '@/components/admin/product-form';
import { Why } from '@/components/ui/kit';

export default function NewProductPage() {
  const { t, can } = useAdmin();
  return (
    <Page title={t('stock.newProduct')} back={{ href: '/admin/stock', label: t('stock.title') }}>
      {can('products.create', null) ? <ProductForm /> : <Why>{t('common:error.forbidden')}</Why>}
    </Page>
  );
}
