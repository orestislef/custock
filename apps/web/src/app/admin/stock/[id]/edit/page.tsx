'use client';

import Link from 'next/link';
import { use } from 'react';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { ProductForm } from '@/components/admin/product-form';
import { Why } from '@/components/ui/kit';
import { IconChevronLeft } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { productName } from '@/lib/names';

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, org, t, locale, can } = useAdmin();
  const p = useAsync(() => api.product(org.orgId, id), [id]);
  return (
    <Page title={p.data ? productName(p.data, locale) : t('productForm.edit')}>
      <Link href={`/admin/stock/${id}`} className="inline-flex items-center min-h-[44px] -ml-2 -mt-3 mb-3 t-body"><IconChevronLeft size={24} />{t('productForm.back')}</Link>
      {!can('products.edit', null) ? <Why>{t('common:error.forbidden')}</Why> : p.data ? <ProductForm product={p.data} /> : <div className="h-40 skel" />}
    </Page>
  );
}
