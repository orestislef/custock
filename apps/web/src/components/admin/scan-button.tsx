'use client';

// camera scanning in the browser where BarcodeDetector exists (chrome on android and desktop).
// elsewhere the button is not shown: a usb scanner or typing into the field works everywhere.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Sheet } from '@/components/ui/client-kit';
import { IconBarcode } from '@/components/ui/icons';
import { useT } from '@/lib/i18n-client';

interface Detector { detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]> }
type DetectorCtor = new (opts?: { formats?: string[] }) => Detector;

const noop = () => () => {};
function useHasDetector() {
  return useSyncExternalStore(noop, () => 'BarcodeDetector' in window, () => false);
}

export function ScanButton({ onCode }: { onCode: (code: string, format: string) => void }) {
  const t = useT();
  const has = useHasDetector();
  const [open, setOpen] = useState(false);
  if (!has) return null;
  return (
    <>
      <button type="button" className="icon-btn" aria-label={t('scan.open')} onClick={() => setOpen(true)}><IconBarcode size={22} /></button>
      {open ? <ScanSheet onClose={() => setOpen(false)} onCode={(c, f) => { setOpen(false); onCode(c, f); }} /> : null}
    </>
  );
}

function ScanSheet({ onClose, onCode }: { onClose: () => void; onCode: (code: string, format: string) => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;
    let timer = 0;
    const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
    const detector = new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128', 'qr_code'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        stream = s;
        if (!alive || !video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        const tick = async () => {
          if (!alive || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            if (found[0]) { navigator.vibrate?.(10); onCode(found[0].rawValue, found[0].format); return; }
          } catch { /* keep trying */ }
          timer = window.setTimeout(tick, 150);
        };
        void tick();
      })
      .catch(() => setError(t('scan.noCamera')));
    return () => { alive = false; clearTimeout(timer); stream?.getTracks().forEach((tr) => tr.stop()); };
  }, [onCode, t]);

  return (
    <Sheet open onClose={onClose} title={t('scan.title')}>
      {error ? <p className="t-sub t-2">{error}</p> : (
        <div className="relative overflow-hidden rounded-[16px] mb-3" style={{ aspectRatio: '4 / 3', background: '#000' }}>
          <video ref={video} className="w-full h-full object-cover" muted playsInline />
          <div aria-hidden="true" className="absolute left-[10%] right-[10%] top-1/2 h-[2px]" style={{ background: 'var(--c-accent)', boxShadow: '0 0 12px var(--c-accent)' }} />
        </div>
      )}
      <p className="t-foot t-2 mb-2">{t('scan.hint')}</p>
    </Sheet>
  );
}
