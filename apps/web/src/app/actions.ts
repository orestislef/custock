'use server';

// public actions for the customer pages. no login, the api checks codes and tokens.

import { JoinInput, type ErrorCode, type Locale } from '@custock/core';
import { serverApi, isDev } from '@/lib/api-server';
import { getLocale } from '@/lib/i18n-server';

export interface JoinState {
  status: 'idle' | 'pending' | 'error';
  error?: ErrorCode | 'over15' | 'email' | 'name';
  // every field that needs a fix, all at once, and what the person typed so nothing is lost
  fields?: { name?: true; email?: true; over15?: true };
  values?: { name: string; emailNews: boolean; push: boolean; over15: boolean };
  // a new value per answer, so the form starts again from the typed values after each try
  at?: number;
  devConfirmLink?: string;
  email?: string;
}

function errorCode(e: unknown): ErrorCode {
  const code = (e as { code?: string })?.code;
  return (code as ErrorCode) ?? 'internal';
}

export async function joinAction(code: string, _prev: JoinState, form: FormData): Promise<JoinState> {
  const locale = (await getLocale()) as Locale;
  const raw = {
    name: String(form.get('name') ?? '').trim(),
    email: String(form.get('email') ?? '').trim().toLowerCase(),
    locale,
    emailNews: form.get('emailNews') === 'on',
    push: form.get('push') === 'on',
    over15: form.get('over15') === 'on',
    interests: form.getAll('interests').map(String),
  };
  const values = { name: raw.name, emailNews: raw.emailNews, push: raw.push, over15: raw.over15 };
  const parsed = JoinInput.safeParse(raw);
  if (!parsed.success) {
    const at = (f: string) => parsed.error.issues.some((i) => i.path[0] === f);
    const fields = { ...(at('name') ? { name: true as const } : {}), ...(at('email') ? { email: true as const } : {}), ...(at('over15') ? { over15: true as const } : {}) };
    const first = fields.name ? 'name' : fields.email ? 'email' : fields.over15 ? 'over15' : 'validation';
    return { status: 'error', error: first, fields, values, email: raw.email, at: Date.now() };
  }
  try {
    const { api } = await serverApi(locale);
    const res = await api.join(code, parsed.data);
    return { status: 'pending', email: raw.email, devConfirmLink: isDev ? res.devConfirmLink : undefined };
  } catch (e) {
    return { status: 'error', error: errorCode(e), values, email: raw.email, at: Date.now() };
  }
}

export interface UnsubscribeState { status: 'idle' | 'done' | 'error'; error?: ErrorCode }

export async function unsubscribeAction(token: string, scope: 'shop' | 'org', prev: UnsubscribeState): Promise<UnsubscribeState> {
  if (prev.status === 'done') return prev;
  try {
    const { api, mode } = await serverApi();
    // the sample data has no email tokens, so only the real api records the stop
    if (mode === 'real') await api.unsubscribe(token, scope === 'org');
    return { status: 'done' };
  } catch (e) {
    return { status: 'error', error: errorCode(e) };
  }
}

export interface EmailRevertState { status: 'idle' | 'done' | 'error'; error?: ErrorCode; email?: string }

// the way back from the notice to the old address after a login email change. the page only shows
// a button, the change needs the press, so email scanners that open links change nothing.
export async function emailRevertAction(token: string, prev: EmailRevertState): Promise<EmailRevertState> {
  if (prev.status === 'done') return prev;
  try {
    const { api } = await serverApi();
    const r = await api.revertEmailChange(token);
    return { status: 'done', email: r.email };
  } catch (e) {
    return { status: 'error', error: errorCode(e) };
  }
}
