'use client';

import { use } from 'react';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { ProductForm } from '@/components/admin/product-form';
import { useAsync } from '@/lib/use-async';
import { productName } from '@/lib/names';
import { RedirectHome } from '@/components/admin/redirect-home';

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, org, t, locale, can } = useAdmin();
  const p = useAsync(() => api.product(org.orgId, id), [id]);
  if (!can('products.edit', null)) return <RedirectHome />;
  return (
    <Page title={p.data ? productName(p.data, locale) : t('productForm.edit')} back={{ href: `/admin/stock/${id}`, label: t('productForm.back') }}>
      {p.data ? <ProductForm product={p.data} /> : <div className="h-40 skel" />}
    </Page>
  );
}
