// which picture a business icon is: its logo file (the url names the upload) or the monogram of its
// name. part of every icon url, on the web and in pushes, so a new logo is a new url and no cache
// keeps showing the old one.
export function iconVersion(name: string, logoUrl?: string | null): string {
  const src = logoUrl ? `logo:${logoUrl.split('/').pop() ?? logoUrl}` : `name:${name}`;
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
