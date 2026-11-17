'use client';

import { use } from 'react';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { ProductForm } from '@/components/admin/product-form';
import { Why } from '@/components/ui/kit';
import { useAsync } from '@/lib/use-async';
import { productName } from '@/lib/names';

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, org, t, locale, can } = useAdmin();
  const p = useAsync(() => api.product(org.orgId, id), [id]);
  return (
    <Page title={p.data ? productName(p.data, locale) : t('productForm.edit')} back={{ href: `/admin/stock/${id}`, label: t('productForm.back') }}>
      {!can('products.edit', null) ? <Why>{t('common:error.forbidden')}</Why> : p.data ? <ProductForm product={p.data} /> : <div className="h-40 skel" />}
    </Page>
  );
}
