// the signing secrets must be real outside dev: long enough and not a placeholder copied from
// deploy/env.example ("change-me..."), which is public. the jwt secret signs every session and,
// derived, the upload slots and unsubscribe links, so a known value means anyone can sign in.

export const DEV_SECRET = 'dev-only-secret-change-me-before-anything-real';
export const MIN_SECRET_LENGTH = 32;

function problem(name: string, value: string | undefined, required: boolean): string | null {
  if (value === undefined || value === '') return required ? `${name} must be set to a random value of at least ${MIN_SECRET_LENGTH} characters (or run with CUSTOCK_DEV=1 locally)` : null;
  if (value.length < MIN_SECRET_LENGTH) return `${name} must be at least ${MIN_SECRET_LENGTH} characters`;
  if (/change-?me/i.test(value) || value === DEV_SECRET) return `${name} is still a placeholder, set a random value (for example openssl rand -hex 32)`;
  return null;
}

export function secretProblems(env: Record<string, string | undefined>, dev: boolean): string[] {
  if (dev) return [];
  return [problem('CUSTOCK_JWT_SECRET', env.CUSTOCK_JWT_SECRET, true), problem('CUSTOCK_UNSUB_SECRET', env.CUSTOCK_UNSUB_SECRET, false)].filter((x): x is string => !!x);
}
