// local checks before a release. no ci/cd, run by hand: pnpm check
// runs typecheck and tests in every package, then the missing translations check.

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let failed = 0;

function run(label, cmd) {
  process.stdout.write(`\n> ${label}\n`);
  try {
    execSync(cmd, { cwd: root, stdio: 'inherit' });
  } catch {
    failed++;
    process.stdout.write(`  failed: ${label}\n`);
  }
}

function flatKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k.replace(/_(zero|one|two|few|many|other)$/, '')}`],
  );
}

function checkTranslations() {
  process.stdout.write('\n> translations\n');
  const dir = join(root, 'packages/i18n/src/locales');
  const namespaces = readdirSync(join(dir, 'en')).filter((f) => f.endsWith('.json'));
  let missing = 0;
  for (const ns of namespaces) {
    const en = new Set(flatKeys(JSON.parse(readFileSync(join(dir, 'en', ns), 'utf8'))));
    for (const locale of ['el', 'ru']) {
      const other = new Set(flatKeys(JSON.parse(readFileSync(join(dir, locale, ns), 'utf8'))));
      for (const key of en) if (!other.has(key)) { missing++; process.stdout.write(`  ${locale}/${ns}: missing ${key}\n`); }
      for (const key of other) if (!en.has(key)) process.stdout.write(`  ${locale}/${ns}: extra ${key}\n`);
    }
  }
  if (missing) failed++;
  process.stdout.write(missing ? `  ${missing} missing\n` : '  all keys present in en, el, ru\n');
}

run('typecheck', 'pnpm -r --if-present typecheck');
run('tests', 'pnpm -r --if-present test');
checkTranslations();

process.stdout.write(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
