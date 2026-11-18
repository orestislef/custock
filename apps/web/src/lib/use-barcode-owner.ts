'use client';

// which product already has this code, while it is being typed or scanned, so a duplicate shows
// before Create instead of after. a lookup without a shop records nothing as an unknown scan.

import { useEffect, useState } from 'react';
import type { CustockApi } from '@custock/core';

export interface BarcodeOwner { productId: string; name: string }

export function useBarcodeOwner(api: CustockApi, orgId: string, code: string, exceptProductId?: string | null, locale?: string): BarcodeOwner | null {
  // the last answer and the code it was for: a different code shows nothing until its own answer
  const [answer, setAnswer] = useState<{ code: string; owner: BarcodeOwner | null } | null>(null);
  const raw = code.trim();
  useEffect(() => {
    if (raw.length < 4) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      api.scan(orgId, raw).then(
        (r) => {
          if (!alive) return;
          const p = r.product;
          const owner = r.match !== 'unknown' && p && p.id !== exceptProductId
            ? { productId: p.id, name: (locale && p.translations?.[locale]?.name) || p.displayName || p.name }
            : null;
          setAnswer({ code: raw, owner });
        },
        () => { if (alive) setAnswer({ code: raw, owner: null }); },
      );
    }, 400);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [api, orgId, raw, exceptProductId, locale]);
  return raw.length >= 4 && answer?.code === raw ? answer.owner : null;
}
