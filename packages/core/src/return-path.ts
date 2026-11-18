// where to go after signing in, from a ?next= value. only a path inside this app is ever accepted:
// relative, starting with one slash, under the app's own areas, never a full url, a protocol
// relative url (//host), a backslash trick or a control character. anything else gives null and
// the caller goes to its normal start page.

// the areas a link from a notification or an email may open after sign in
const AREAS = [/^\/admin(\/|$|\?|#)/, /^\/s\/[a-z0-9-]{1,80}(\/|$|\?|#)/, /^\/p\/[^/?#]{1,64}(\?|#|$)/];
// pages that would send the person straight back to signing in
const NEVER = [/^\/admin\/login(\/|$|\?|#)/, /^\/admin\/forgot(\/|$|\?|#)/, /^\/admin\/reset(\/|$|\?|#)/];

const BACKSLASH = String.fromCharCode(92);

// control characters (below space, and delete) never belong in a path someone clicked
function hasControl(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

export function safeReturnPath(raw: string | null | undefined, basePath = ''): string | null {
  if (typeof raw !== 'string') return null;
  let v = raw.trim();
  if (!v || v.length > 512) return null;
  // backslashes and encoded slashes, backslashes or nul are tricks, never our own links
  if (hasControl(v) || v.includes(BACKSLASH) || /%(2f|5c|00)/i.test(v)) return null;
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  // a path that still carries the base path (for example from location.pathname)
  const base = basePath.replace(/\/$/, '');
  if (base && (v === base || v.startsWith(`${base}/`) || v.startsWith(`${base}?`))) v = v.slice(base.length) || '/';
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  // parse against a throwaway origin: anything that resolves elsewhere is refused
  let u: URL;
  try {
    u = new URL(v, 'https://return.invalid');
  } catch {
    return null;
  }
  if (u.origin !== 'https://return.invalid' || u.username || u.password) return null;
  const path = `${u.pathname}${u.search}${u.hash}`;
  if (!AREAS.some((r) => r.test(path))) return null;
  if (NEVER.some((r) => r.test(path))) return null;
  return path;
}

// the value to put in ?next= for the page someone is on now
export function returnParam(pathname: string, search = '', basePath = ''): string | null {
  return safeReturnPath(`${pathname}${search}`, basePath);
}
