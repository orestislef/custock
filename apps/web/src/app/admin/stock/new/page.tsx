'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { ProductForm } from '@/components/admin/product-form';
import { RedirectHome } from '@/components/admin/redirect-home';

// a new product, also from an unknown scan (?code=...), which fills in the barcode
export default function NewProductPage() {
  return <Suspense><NewProduct /></Suspense>;
}

function NewProduct() {
  const { t, can } = useAdmin();
  const code = useSearchParams().get('code') ?? undefined;
  if (!can('products.create', null)) return <RedirectHome />;
  return (
    <Page title={t('stock.newProduct')} back={code ? { href: '/admin/scan', label: t('scanner.title') } : { href: '/admin/stock', label: t('stock.title') }}>
      <ProductForm initialBarcode={code} />
    </Page>
  );
}
