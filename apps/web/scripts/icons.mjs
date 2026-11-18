// app icons for the home screen, made from assets/icon-source.png (1024 px, full bleed).
// run once after the source changes: node scripts/icons.mjs. the results are committed.

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets', 'icon-source.png');
const out = join(root, 'public', 'icons');
mkdirSync(out, { recursive: true });

const png = (size, file) => sharp(src).resize(size, size).png({ compressionLevel: 9, palette: true }).toFile(join(out, file));

await png(192, 'icon-192.png');
await png(512, 'icon-512.png');
// the artwork already keeps to the centre 80 percent, so the maskable icon is the same picture
await png(512, 'maskable-512.png');
// the android status bar badge: a white silhouette on transparent, the system tints it
const badge = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><g fill="#fff"><circle cx="36" cy="48" r="22"/><circle cx="60" cy="48" r="22"/></g></svg>');
await sharp(badge).png({ compressionLevel: 9 }).toFile(join(out, 'badge-96.png'));
// linked from the metadata (src/lib/manifests.ts), so the base path is always right
await png(180, 'apple-touch-icon.png');
await png(64, 'favicon-64.png');
console.log('icons written to public/icons');
