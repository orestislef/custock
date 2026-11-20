'use client';

// a business beside its name: its logo when it has one, the shop symbol otherwise
import { useState } from 'react';
import { IconShop } from './icons';

export function BusinessMark({ logoUrl, size = 32, tile = true }: { logoUrl?: string | null; size?: number; tile?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (logoUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt="" width={size} height={size} className="flex-none object-cover"
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.24), background: '#fff' }} onError={() => setBroken(true)} />
    );
  }
  return tile ? <span className="icon-tile flex-none" style={{ width: size, height: size }}><IconShop size={Math.round(size * 0.56)} /></span> : null;
}
