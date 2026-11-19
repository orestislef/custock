'use client';

// the camera that reads barcodes. it asks for the camera only after a tap on "Use the camera",
// with one line on why (nothing is recorded). once allowed it starts by itself next time. it
// stops the camera when the page goes to the background and reads continuously. which reads count
// is decided by ScanFilter (@custock/core): only codes inside the white frame, one item at a time,
// and an item held in front of it counts once.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconCamera, IconTorch } from '@/components/ui/icons';
import { useT } from '@/lib/i18n-client';
import { ScanFilter, aimInVideo, readsInAim, type Read } from '@custock/core';
import { buzz, cameraPermission, createDetector, hasCamera, openCamera, setTorch, torchSupported } from '@/lib/scanner';

// an item out of the picture for less than this and back again is the same scan
export const SAME_CODE_GAP_MS = 1500;

type State = 'checking' | 'ask' | 'starting' | 'live' | 'denied' | 'unavailable';

// filter: pass one in to tell it which codes are the same item (ScanFilter.claim) after a lookup.
// silent: the page gives its own feedback once it knows the scan counted.
export function Camera({ onCode, overlay, actions, paused, filter, silent, height = 'min(46vh, 420px)' }: {
  onCode: (raw: string, format: string) => void;
  filter?: ScanFilter;
  silent?: boolean;
  overlay?: ReactNode;
  actions?: ReactNode;
  paused?: boolean;
  height?: string;
}) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<State>('checking');
  const [torch, setTorchOn] = useState(false);
  const [canTorch, setCanTorch] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const aimRef = useRef<HTMLDivElement>(null);
  const own = useRef<ScanFilter | null>(null);
  const filterRef = useRef(filter);
  useEffect(() => { filterRef.current = filter; }, [filter]);
  const pausedRef = useRef(!!paused);
  useEffect(() => { pausedRef.current = !!paused; }, [paused]);
  const silentRef = useRef(!!silent);
  useEffect(() => { silentRef.current = !!silent; }, [silent]);
  const handler = useRef(onCode);
  useEffect(() => { handler.current = onCode; }, [onCode]);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    setTorchOn(false);
  }, []);

  const start = useCallback(async () => {
    if (!hasCamera() || !window.isSecureContext) { setState('unavailable'); return; }
    setState('starting');
    try {
      const s = await openCamera();
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => {});
      }
      setCanTorch(torchSupported(s));
      setState('live');
    } catch (e) {
      const name = (e as { name?: string }).name;
      setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
    }
  }, []);

  // allowed before: start right away. otherwise wait for the tap
  useEffect(() => {
    let alive = true;
    void cameraPermission().then((p) => {
      if (!alive) return;
      if (!hasCamera() || !window.isSecureContext) setState('unavailable');
      else if (p === 'granted') void start();
      else setState(p === 'denied' ? 'denied' : 'ask');
    });
    return () => { alive = false; stop(); };
  }, [start, stop]);

  // free the camera in the background, take it again when back
  const wasLive = useRef(false);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        if (stream.current) { wasLive.current = true; stop(); setState('checking'); }
      } else if (wasLive.current) {
        wasLive.current = false;
        void start();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [start, stop]);

  // the reading loop. while paused (saving) it keeps watching, so an item still in the picture is
  // not taken for a new one afterwards, but nothing it sees then counts.
  useEffect(() => {
    if (state !== 'live') return;
    let alive = true;
    let timer = 0;
    void createDetector().then((detector) => {
      const tick = async () => {
        if (!alive) return;
        const v = video.current;
        if (v && v.readyState >= 2 && v.videoWidth > 0) {
          try {
            const found = await detector.detect(v);
            if (alive && found.length) {
              const reads: Read[] = found.filter((f) => f.rawValue).map((f) => ({ raw: f.rawValue, format: f.format, box: f.boundingBox ? { x: f.boundingBox.x, y: f.boundingBox.y, width: f.boundingBox.width, height: f.boundingBox.height } : undefined }));
              const frame = aimRef.current?.getBoundingClientRect();
              const outer = box.current?.getBoundingClientRect();
              const inAim = frame && outer && outer.width > 0
                ? readsInAim(reads, aimInVideo({ width: v.videoWidth, height: v.videoHeight }, { width: outer.width, height: outer.height }, { x: frame.left - outer.left, y: frame.top - outer.top, width: frame.width, height: frame.height }))
                : reads.map((r) => ({ ...r, distance: 0 }));
              const f = filterRef.current ?? (own.current ??= new ScanFilter(SAME_CODE_GAP_MS));
              const hit = f.frame(inAim, Date.now());
              if (hit && !pausedRef.current) {
                if (!silentRef.current) buzz();
                handler.current(hit.raw, hit.format);
              }
            }
          } catch { /* a frame that could not be read, keep going */ }
        }
        timer = window.setTimeout(tick, 120);
      };
      void tick();
    }).catch(() => setState('unavailable'));
    return () => { alive = false; clearTimeout(timer); };
  }, [state]);

  const toggleTorch = async () => {
    const next = !torch;
    await setTorch(stream.current, next);
    setTorchOn(next);
  };

  return (
    <div ref={box} className="scan-camera" style={{ height }}>
      <video ref={video} className="scan-video" muted playsInline autoPlay aria-hidden="true" style={{ opacity: state === 'live' ? 1 : 0 }} />
      {state === 'live' ? (
        <div ref={aimRef} className="scan-frame" aria-hidden="true"><span className="scan-line" /></div>
      ) : (
        <div className="scan-empty" role={state === 'denied' || state === 'unavailable' ? 'status' : undefined}>
          <IconCamera size={40} />
          {state === 'ask' ? (
            <>
              <p className="t-sub m-0">{t('scanner.cameraWhy')}</p>
              <button type="button" className="btn btn-primary" onClick={() => void start()}>{t('scanner.useCamera')}</button>
            </>
          ) : state === 'denied' ? (
            <>
              <p className="t-sub m-0">{t('scanner.denied')}</p>
              <button type="button" className="btn btn-gray" onClick={() => void start()}>{t('common:action.retry')}</button>
            </>
          ) : state === 'unavailable' ? (
            <p className="t-sub m-0">{t('scanner.unavailable')}</p>
          ) : (
            <p className="t-sub m-0" aria-busy="true">{t('scanner.starting')}</p>
          )}
        </div>
      )}
      <div className="scan-top">
        <div className="flex flex-col items-start gap-1.5 min-w-0">{overlay}</div>
        <div className="flex gap-2">
          {state === 'live' && canTorch ? (
            <button type="button" className="scan-round" aria-pressed={torch} aria-label={t('scanner.torch')} onClick={() => void toggleTorch()} style={torch ? { color: '#FFD60A' } : undefined}>
              <IconTorch size={22} filled={torch} />
            </button>
          ) : null}
          {actions}
        </div>
      </div>
    </div>
  );
}
