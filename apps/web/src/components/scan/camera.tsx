'use client';

// the camera that reads barcodes. it asks for the camera only after a tap on "Use the camera",
// with one line on why (nothing is recorded). once allowed it starts by itself next time. it
// stops the camera when the page goes to the background and reads continuously, ignoring the
// same code held in front of it.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconCamera, IconTorch } from '@/components/ui/icons';
import { useT } from '@/lib/i18n-client';
import { buzz, cameraPermission, createDetector, hasCamera, openCamera, setTorch, torchSupported } from '@/lib/scanner';

type State = 'checking' | 'ask' | 'starting' | 'live' | 'denied' | 'unavailable';

export function Camera({ onCode, overlay, actions, paused, height = 'min(46vh, 420px)' }: {
  onCode: (raw: string, format: string) => void;
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
  const last = useRef<{ code: string; at: number } | null>(null);
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

  // the reading loop
  useEffect(() => {
    if (state !== 'live' || paused) return;
    let alive = true;
    let timer = 0;
    void createDetector().then((detector) => {
      const tick = async () => {
        if (!alive) return;
        const v = video.current;
        if (v && v.readyState >= 2 && v.videoWidth > 0) {
          try {
            const found = await detector.detect(v);
            const hit = found.find((f) => f.rawValue);
            if (hit && alive) {
              const now = Date.now();
              // holding still is one scan, not twenty
              if (!last.current || last.current.code !== hit.rawValue || now - last.current.at > 1500) {
                buzz();
                handler.current(hit.rawValue, hit.format);
              }
              last.current = { code: hit.rawValue, at: now };
            }
          } catch { /* a frame that could not be read, keep going */ }
        }
        timer = window.setTimeout(tick, 120);
      };
      void tick();
    }).catch(() => setState('unavailable'));
    return () => { alive = false; clearTimeout(timer); };
  }, [state, paused]);

  const toggleTorch = async () => {
    const next = !torch;
    await setTorch(stream.current, next);
    setTorchOn(next);
  };

  return (
    <div className="scan-camera" style={{ height }}>
      <video ref={video} className="scan-video" muted playsInline autoPlay aria-hidden="true" style={{ opacity: state === 'live' ? 1 : 0 }} />
      {state === 'live' ? (
        <div className="scan-frame" aria-hidden="true"><span className="scan-line" /></div>
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
