'use client';

// a barcode field's camera button: opens the camera in a sheet and hands back the first code read.
// works in every browser with a camera (native BarcodeDetector or the wasm reader). a usb scanner
// or typing into the field works everywhere too.

import { useState, useSyncExternalStore } from 'react';
import { Sheet } from '@/components/ui/client-kit';
import { IconBarcode } from '@/components/ui/icons';
import { Camera } from '@/components/scan/camera';
import { useT } from '@/lib/i18n-client';
import { hasCamera } from '@/lib/scanner';

const noop = () => () => {};

export function ScanButton({ onCode }: { onCode: (code: string, format: string) => void }) {
  const t = useT();
  const has = useSyncExternalStore(noop, () => hasCamera() && window.isSecureContext, () => false);
  const [open, setOpen] = useState(false);
  if (!has) return null;
  return (
    <>
      <button type="button" className="icon-btn" aria-label={t('scan.open')} onClick={() => setOpen(true)}><IconBarcode size={22} /></button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('scan.title')}>
        {open ? <Camera height="min(52vh, 360px)" onCode={(c, f) => { setOpen(false); onCode(c, f); }} /> : null}
        <p className="t-foot t-2 mt-3 mb-2">{t('scan.hint')}</p>
      </Sheet>
    </>
  );
}
