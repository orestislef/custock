'use client';

// web push on this device. permission is only ever asked from a tap, never on load. on iphones
// push works only once the site is on the home screen (ios 16.4 and newer), so there the answer
// is the install coach instead. the server keeps one subscription per browser, scoped to a
// business for a shop's home screen app (orgId) or to the staff app (orgId null).

import type { CustockApi, Locale } from '@custock/core';
import { basePath, loadTokens } from './api-client';
import { kvGet, kvSet } from './idb';
import { isIOS, isStandalone } from './pwa';

// which people want alerts on this device. signing out removes the subscription from the server
// and the browser, signing in again brings it back for the same person without asking again.
// another person signing in on the same device does not get them until they turn them on.
const WANTED_KEY = 'custock.push.wanted';

function currentUserId(): string | null {
  const token = loadTokens()?.accessToken;
  if (!token || token.split('.').length !== 3) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function wantedList(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(WANTED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function setWanted(orgId: string | null, on: boolean) {
  const user = currentUserId();
  if (!user) return;
  const key = `${user}:${orgId ?? 'staff'}`;
  const list = wantedList().filter((x) => x !== key);
  if (on) list.push(key);
  try { localStorage.setItem(WANTED_KEY, JSON.stringify(list.slice(-20))); } catch {}
}

function isWanted(orgId: string | null): boolean {
  const user = currentUserId();
  return !!user && wantedList().includes(`${user}:${orgId ?? 'staff'}`);
}

export type PushState = 'unsupported' | 'install' | 'denied' | 'default' | 'granted';

export function pushState(): PushState {
  if (typeof window === 'undefined') return 'unsupported';
  if (isIOS() && !isStandalone()) return 'install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return Notification.permission === 'denied' ? 'denied' : Notification.permission === 'granted' ? 'granted' : 'default';
}

// the service worker only runs in production builds (dev chunks change on every save)
// no service worker in the public demo: its pages are static files on another site
export const swEnabled = process.env.NEXT_PUBLIC_DEMO !== '1' && (process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_SW === '1');

export async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!swEnabled || !('serviceWorker' in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration(`${basePath}/`);
  if (existing) return existing;
  try {
    return await navigator.serviceWorker.register(`${basePath}/sw.js`, { scope: `${basePath}/` });
  } catch {
    return null;
  }
}

// the worker of this registration, once running. not navigator.serviceWorker.ready: the base path
// itself (/custock, no slash) sits outside the worker's scope and would wait forever
function activated(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return Promise.resolve();
  const sw = reg.installing ?? reg.waiting;
  return new Promise((resolve) => {
    const done = () => resolve();
    const timer = window.setTimeout(done, 10_000);
    sw?.addEventListener('statechange', () => { if (sw.state === 'activated') { clearTimeout(timer); done(); } });
  });
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// a subscription belongs to one server key. a new key (a dev api restart, a key rotation on the
// server) means subscribing again, which needs no new permission
function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const used = sub.options?.applicationServerKey;
  if (!used) return true; // the browser does not tell, keep it
  const a = new Uint8Array(used);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

async function subscribe(reg: ServiceWorkerRegistration, publicKey: string): Promise<PushSubscription> {
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, publicKey)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  return sub ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
}

function toInput(sub: PushSubscription, orgId: string | null, locale?: Locale) {
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  return { endpoint: json.endpoint ?? sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' }, orgId, locale };
}

export type EnableResult = 'on' | 'off' | 'denied' | 'install' | 'unsupported' | 'failed';

// call from a click handler only
export async function enablePush(api: CustockApi, opts: { orgId: string | null; locale?: Locale }): Promise<EnableResult> {
  const state = pushState();
  if (state === 'install' || state === 'unsupported') return state;
  const key = await api.pushKey().catch(() => null);
  if (!key) return 'off';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'failed';
  const reg = await registration();
  if (!reg) return 'unsupported';
  await activated(reg);
  try {
    const sub = await subscribe(reg, key.publicKey);
    await api.savePushSubscription(toInput(sub, opts.orgId, opts.locale));
    await kvSet('push.saved', { at: Date.now(), orgId: opts.orgId }).catch(() => {});
    setWanted(opts.orgId, true);
    // in a business's own app this tap is also the yes to its notifications. for its team the
    // call has nothing to do and is turned away, which is fine
    if (opts.orgId) await api.setChannel(opts.orgId, 'push', true).catch(() => {});
    return 'on';
  } catch {
    return 'failed';
  }
}

// signing out keeps the wish (forget false), turning the switch off forgets it
export async function disablePush(api: CustockApi, opts: { forget?: boolean; orgId?: string | null } = {}): Promise<void> {
  if (opts.forget) setWanted(opts.orgId ?? null, false);
  // turning the switch off in a business's app is a no to its notifications too (signing out is not)
  if (opts.forget && opts.orgId) await api.setChannel(opts.orgId, 'push', false).catch(() => {});
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  await api.deletePushSubscription(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export async function pushIsOn(): Promise<boolean> {
  if (pushState() !== 'granted') return false;
  return !!(await currentSubscription().catch(() => null));
}

// the browser can rotate a subscription and the server can change its key, and the service worker
// cannot reach the api (the session lives in this page). so the page checks both and sends the
// current subscription again when anything changed, else at most once a day.
export async function refreshSubscription(api: CustockApi, opts: { orgId: string | null; locale?: Locale }): Promise<void> {
  if (pushState() !== 'granted') return;
  const reg = await registration();
  if (!reg) return;
  const existing = await reg.pushManager.getSubscription().catch(() => null);
  // signed out and back in: the same person had alerts on here, so they come back on their own
  if (!existing && !isWanted(opts.orgId)) return;
  const key = await api.pushKey().catch(() => undefined);
  if (key === undefined) return; // offline, try next time
  if (key === null) return; // the server stopped sending push, nothing to do here
  if (!existing) {
    await activated(reg);
    const fresh = await subscribe(reg, key.publicKey).catch(() => null);
    if (fresh) await api.savePushSubscription(toInput(fresh, opts.orgId, opts.locale)).then(() => kvSet('push.refreshed', { at: Date.now(), endpoint: fresh.endpoint }), () => {});
    return;
  }
  let sub = existing;
  if (!sameKey(existing, key.publicKey)) sub = await subscribe(reg, key.publicKey).catch(() => existing);
  const last = await kvGet<{ at: number; endpoint?: string }>('push.refreshed').catch(() => null);
  if (sub === existing && last && last.endpoint === sub.endpoint && Date.now() - last.at < 86_400_000) return;
  await api.savePushSubscription(toInput(sub, opts.orgId, opts.locale)).then(
    () => kvSet('push.refreshed', { at: Date.now(), endpoint: sub.endpoint }),
    () => {},
  );
}

// development only: shows a notification on this device without any push service involved
export async function showLocalNotification(title: string, body: string, url?: string, tag?: string): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') return false;
  const reg = await registration();
  const options: NotificationOptions = { body, icon: `${basePath}/icons/icon-192.png`, badge: `${basePath}/icons/badge-96.png`, tag, data: { url: url ?? `${basePath}/` } };
  if (reg) { await reg.showNotification(title, options); return true; }
  new Notification(title, options);
  return true;
}
