'use client';

// one switch for notifications on this device. the browser's permission prompt only ever follows
// a tap on it. when push cannot work here the row says why instead of failing quietly.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CustockApi, Locale } from '@custock/core';
import { Switch } from '@/components/ui/kit';
import { IconBell } from '@/components/ui/icons';
import { useLocale, useT } from '@/lib/i18n-client';
import { disablePush, enablePush, pushIsOn, pushState, type PushState } from '@/lib/push';

type Why = 'install' | 'denied' | 'off' | 'unsupported' | 'failed' | null;

export function usePushSwitch(api: CustockApi, orgId: string | null) {
  const locale = useLocale() as Locale;
  const [on, setOn] = useState(false);
  const [state, setState] = useState<PushState>(() => pushState());
  const [serverHasPush, setServerHasPush] = useState<boolean | null>(null);
  const [why, setWhy] = useState<Why>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void pushIsOn().then((v) => { if (alive) setOn(v); });
    void api.pushKey().then((k) => { if (alive) setServerHasPush(!!k); }, () => { if (alive) setServerHasPush(false); });
    return () => { alive = false; };
  }, [api]);

  // true when notifications are on afterwards
  const toggle = async (next: boolean): Promise<boolean> => {
    setBusy(true);
    setWhy(null);
    try {
      if (!next) {
        await disablePush(api);
        setOn(false);
        return false;
      }
      const r = await enablePush(api, { orgId, locale });
      setState(pushState());
      if (r === 'on') setOn(true);
      else setWhy(r);
      return r === 'on';
    } catch {
      setWhy('failed');
      return false;
    } finally {
      setBusy(false);
    }
  };

  // what to say when the switch cannot be used at all
  const blocked: Why = serverHasPush === false ? 'off' : state === 'install' ? 'install' : state === 'denied' ? 'denied' : state === 'unsupported' ? 'unsupported' : null;
  return { on, toggle, busy, why: why ?? blocked, blocked, ready: serverHasPush !== null };
}

export function PushRow({ api, orgId, title, sub, onInstall, icon }: { api: CustockApi; orgId: string | null; title: string; sub?: string; onInstall?: () => void; icon?: ReactNode }) {
  const t = useT();
  const p = usePushSwitch(api, orgId);
  if (!p.ready) return null;
  return (
    <div className="row has-icon">
      {icon ?? <span className="icon-tile"><IconBell size={18} /></span>}
      <span className="row-main">
        <span className="row-title block">{title}</span>
        {sub && !p.why ? <span className="row-sub block">{sub}</span> : null}
        {p.why ? <span className="row-sub block" role="status">{t(`push.why.${p.why}`)}</span> : null}
        {p.why === 'install' && onInstall ? (
          <button type="button" className="btn btn-plain" style={{ minHeight: 36, padding: 0 }} onClick={onInstall}>{t('pwa.showHow')}</button>
        ) : null}
        {p.on ? <TestPushButton api={api} orgId={orgId} variant="plain" /> : null}
      </span>
      {p.blocked ? null : <Switch checked={p.on} disabled={p.busy} label={title} onChange={(v) => void p.toggle(v)} />}
    </div>
  );
}

type TestResult = 'sent' | 'none' | 'wait' | 'failed' | null;

// sends one notification to this person's own devices, so they can see what alerts look like
export function TestPushButton({ api, orgId, variant }: { api: CustockApi; orgId: string | null; variant: 'plain' | 'tinted' }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.testPush(orgId);
      setResult(r.devices > 0 ? 'sent' : 'none');
    } catch (e) {
      setResult((e as { status?: number }).status === 429 ? 'wait' : 'failed');
    } finally {
      setBusy(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setResult(null), 8000);
    }
  };

  return (
    <span className="flex flex-col items-start">
      <button
        type="button"
        className={variant === 'plain' ? 'btn btn-plain' : 'btn btn-tinted'}
        style={variant === 'plain' ? { minHeight: 36, padding: 0 } : undefined}
        disabled={busy}
        onClick={() => void send()}
      >
        {t('push.test.send')}
      </button>
      {result ? <span className="t-foot t-2 block" role="status">{t(`push.test.${result}`)}</span> : null}
    </span>
  );
}
