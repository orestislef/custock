// the barcode reader for browsers without a native BarcodeDetector (safari, firefox, desktop
// chrome on windows). served from our own origin, never from a cdn. runs before dev and build.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
// zxing-wasm as barcode-detector sees it, so the wasm always matches its javascript
let dir = dirname(require.resolve('zxing-wasm/reader', { paths: [dirname(require.resolve('barcode-detector'))] }));
while (!(existsSync(join(dir, 'package.json')) && JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === 'zxing-wasm')) {
  const up = dirname(dir);
  if (up === dir) throw new Error('zxing-wasm not found');
  dir = up;
}
const dest = join(root, 'public', 'wasm');
mkdirSync(dest, { recursive: true });
copyFileSync(join(dir, 'dist', 'reader', 'zxing_reader.wasm'), join(dest, 'zxing_reader.wasm'));
