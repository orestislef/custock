'use client';

import { useState } from 'react';
import type { Category } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { StockTabs } from '@/components/admin/stock-tabs';
import { CategorySheet } from '@/components/admin/category-sheet';
import { CategoryPicture } from '@/components/ui/category-picture';
import { RedirectHome } from '@/components/admin/redirect-home';
import { Empty, Group } from '@/components/ui/kit';
import { Sheet, useToast } from '@/components/ui/client-kit';
import { IconChevronRight, IconPlus, IconTag } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { forgetCatalog } from '@/lib/use-names';

export default function CategoriesPage() {
  const { api, org, t, can } = useAdmin();
  const toast = useToast();
  const allowed = can('categories.manage', null);
  const list = useAsync(() => (allowed ? api.categories(org.orgId) : Promise.resolve([] as Category[])), [allowed]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);

  if (!allowed) return <RedirectHome />;
  const cats = list.data ?? [];

  const saved = (c: Category, created: boolean) => {
    forgetCatalog(org.orgId);
    void list.reload();
    toast(created ? t('categories.created', { name: c.name }) : t('categories.saved'));
  };

  const remove = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await api.deleteCategory(org.orgId, deleting.id);
      forgetCatalog(org.orgId);
      toast(t('categories.deleted', { name: deleting.name }));
      setDeleting(null);
      void list.reload();
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  };

  const add = <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={18} />{t('categories.new')}</button>;

  return (
    <Page title={t('categories.title')}
      actions={cats.length ? add : null}
      phoneAction={cats.length ? <button type="button" className="icon-btn" style={{ background: 'var(--c-accent-tint)' }} aria-label={t('categories.new')} onClick={() => setCreating(true)}><IconPlus size={22} /></button> : undefined}>
      <StockTabs />
      {list.data && !cats.length ? (
        <Empty icon={<IconTag size={40} />} title={t('categories.emptyTitle')} body={t('categories.emptyBody')} action={add} />
      ) : (
        <Group footer={t('categories.listFoot')}>
          {cats.map((c) => (
            <div key={c.id} className="row has-icon">
              {c.imageUrl || c.iconKey ? (
                <CategoryPicture iconKey={c.iconKey} imageUrl={c.imageUrl} size={36} rounded={9} />
              ) : (
                <span className="icon-tile" aria-hidden="true"><IconTag size={18} /></span>
              )}
              <button type="button" className="row-main text-left min-w-0" onClick={() => setEditing(c)}>
                <span className="row-title block truncate">{c.name}</span>
                {Object.keys(c.names ?? {}).length > 1 ? (
                  <span className="row-sub block truncate">{Object.entries(c.names ?? {}).filter(([, n]) => n !== c.name).map(([, n]) => n).join(' · ')}</span>
                ) : null}
              </button>
              <button type="button" className="btn btn-danger" onClick={() => setDeleting(c)}>{t('common:action.delete')}</button>
              <IconChevronRight size={16} className="chev" />
            </div>
          ))}
        </Group>
      )}

      <CategorySheet open={creating} onClose={() => setCreating(false)} onSaved={(c) => saved(c, true)} />
      <CategorySheet open={!!editing} onClose={() => setEditing(null)} category={editing} onSaved={(c) => saved(c, false)} />
      <Sheet open={!!deleting} onClose={() => setDeleting(null)} title={t('categories.deleteTitle', { name: deleting?.name ?? '' })}
        footer={<>
          <button type="button" className="btn btn-gray" onClick={() => setDeleting(null)}>{t('common:action.cancel')}</button>
          <button type="button" className="btn btn-danger-fill" disabled={busy} onClick={() => void remove()}>{t('common:action.delete')}</button>
        </>}>
        <p className="t-body m-0">{t('categories.deleteBody')}</p>
      </Sheet>
    </Page>
  );
}
