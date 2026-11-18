'use client';

// a person's own profile photo: tap the picture or the link to pick one or take one (the phone
// offers the camera), remove it to go back to the initials. the photo is cropped to a square in
// the browser and goes straight to storage.

import { useRef, useState, type ReactNode } from 'react';
import type { CustockApi } from '@custock/core';
import { Avatar } from './kit';
import { useToast } from './client-kit';
import { IconCamera } from './icons';
import { useT } from '@/lib/i18n-client';
import { uploadAvatar } from '@/lib/upload';

export function ProfilePhoto({ api, name, avatarUrl, size = 56, onChanged, children, className }: {
  api: CustockApi;
  name: string | null | undefined;
  avatarUrl: string | null | undefined;
  size?: number;
  onChanged?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  const t = useT();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // shown at once, before the account reloads
  const [local, setLocal] = useState<string | null | undefined>(undefined);
  const shown = local === undefined ? avatarUrl ?? null : local;

  const fail = (e: unknown) => toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadAvatar(api, file);
      await api.updateMe({ avatarFileId: r.fileId });
      setLocal(r.url);
      toast(t('profile.saved'));
      onChanged?.();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.updateMe({ avatarFileId: null });
      setLocal(null);
      toast(t('profile.removed'));
      onChanged?.();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const label = shown ? t('profile.change') : t('profile.add');
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <button type="button" className="relative flex-none rounded-full border-0 p-0 bg-transparent cursor-pointer" onClick={() => input.current?.click()} disabled={busy} aria-label={label}>
        <span style={{ opacity: busy ? 0.5 : 1, transition: 'opacity 150ms' }} className="block"><Avatar name={name} size={size} src={shown} /></span>
        <span aria-hidden="true" className="absolute grid place-items-center rounded-full"
          style={{ right: -2, bottom: -2, width: 24, height: 24, background: 'var(--c-accent-fill, var(--c-accent))', color: '#FFFFFF', boxShadow: '0 0 0 2px var(--c-elevated)' }}>
          <IconCamera size={14} />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        {children}
        <div className="flex flex-wrap gap-x-4">
          <button type="button" className="btn btn-plain" style={{ minHeight: 32, padding: 0 }} disabled={busy} onClick={() => input.current?.click()}>{label}</button>
          {shown ? <button type="button" className="btn btn-plain" style={{ minHeight: 32, padding: 0, color: 'var(--c-error)' }} disabled={busy} onClick={() => void remove()}>{t('profile.remove')}</button> : null}
        </div>
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void choose(e.target.files?.[0])} />
    </div>
  );
}
