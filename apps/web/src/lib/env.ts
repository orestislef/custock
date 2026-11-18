// what kind of build this is. a production build (the server) never shows sample data, dev
// logins, dev links or the dev outbox. CUSTOCK_SHOW_DEV=1 at build time turns them back on for a
// staging copy. local `next dev` keeps everything.

export const devBuild = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_SHOW_DEV === '1';

// the sample business of local development. on a server these come from the environment or not at all
export function defaultJoinCode(): string | null {
  return process.env.CUSTOCK_DEFAULT_JOIN_CODE || (devBuild ? 'ig4m8x' : null);
}

export function defaultOrgSlug(): string | null {
  return process.env.CUSTOCK_DEFAULT_ORG_SLUG || (devBuild ? 'lemoni' : null);
}
