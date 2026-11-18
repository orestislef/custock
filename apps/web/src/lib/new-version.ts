'use client';

// after a deploy, a page that was already open asks for script files of the old version, which
// the server no longer has. that is not a bug to show or report: load the page again once, so the
// new version takes over. at most once a minute, so a real failure cannot loop.

const KEY = 'custock.reloadedForVersion';

export function isStaleChunk(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const text = `${e?.name ?? ''} ${e?.message ?? (typeof err === 'string' ? err : '')}`;
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(text);
}

// true when the page is being reloaded for the new version
export function reloadForNewVersion(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
