'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { ProductForm } from '@/components/admin/product-form';
import { Why } from '@/components/ui/kit';

// a new product, also from an unknown scan (?code=...), which fills in the barcode
export default function NewProductPage() {
  return <Suspense><NewProduct /></Suspense>;
}

function NewProduct() {
  const { t, can } = useAdmin();
  const code = useSearchParams().get('code') ?? undefined;
  return (
    <Page title={t('stock.newProduct')} back={code ? { href: '/admin/scan', label: t('scanner.title') } : { href: '/admin/stock', label: t('stock.title') }}>
      {can('products.create', null) ? <ProductForm initialBarcode={code} /> : <Why>{t('common:error.forbidden')}</Why>}
    </Page>
  );
}
