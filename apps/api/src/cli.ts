// server side setup for a production database, where there is no seed data and no dev login.
//
//   node --import tsx apps/api/src/cli.ts create-business --name "Lemoni" --slug lemoni \
//        --owner-email eleni@example.com [--owner-name "Eleni P"] [--shop "Kifisia"] [--locale el] [--invite | --set-password]
//   node --import tsx apps/api/src/cli.ts invite-owner --org lemoni --email eleni@example.com [--locale el]
//   node --import tsx apps/api/src/cli.ts add-shop --org lemoni --name "Marousi" [--city ...]
//   node --import tsx apps/api/src/cli.ts set-password --email eleni@example.com
//
// create-business makes the owner one of two ways. --invite (the default when mail is live): an
// owner invite, emailed and printed, and the owner sets name and password from the link.
// --set-password (the default otherwise): the account is made now, the password comes from
// CUSTOCK_NEW_PASSWORD, or from stdin with --password-stdin, otherwise a random one is printed once.
// in docker: docker exec -it custock node --import tsx apps/api/src/cli.ts ...
// the database is CUSTOCK_DB (the same file the api uses).

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DEFAULT_DB_PATH, hashPassword, migrate, openDb, type Db } from '@custock/db';
import { setEmailAssetBase } from './email/layout';
import { liveChannels } from './lib/live';
import { platform } from './lib/tenant';
import { addShop, BootstrapError, createBusiness, inviteOwner } from './services/bootstrap';

export const MIN_PASSWORD = 10;

export function parseArgs(argv: string[]): { command: string | undefined; flags: Record<string, string | true> } {
  const [command, ...rest] = argv;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith('--')) throw new BootstrapError(`unexpected argument ${a}`);
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return { command, flags };
}

export function randomPassword(): string {
  // 16 characters without look alikes
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export interface CliIo {
  env: Record<string, string | undefined>;
  readStdin: () => Promise<string>;
  out: (line: string) => void;
}

async function passwordFrom(flags: Record<string, string | true>, io: CliIo): Promise<{ password: string; generated: boolean }> {
  let password = io.env.CUSTOCK_NEW_PASSWORD;
  if (!password && flags['password-stdin']) password = (await io.readStdin()).split(/\r?\n/)[0];
  if (password) {
    if (password.length < MIN_PASSWORD) throw new BootstrapError(`the password needs at least ${MIN_PASSWORD} characters`);
    return { password, generated: false };
  }
  return { password: randomPassword(), generated: true };
}

function str(flags: Record<string, string | true>, key: string, required = true): string | undefined {
  const v = flags[key];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (required) throw new BootstrapError(`--${key} is required`);
  return undefined;
}

// mail really leaves this server: live transport, the yes, and a complete smtp setting
export function mailIsLive(env: Record<string, string | undefined>): boolean {
  if (env.CUSTOCK_TRANSPORT !== 'live') return false;
  const r = liveChannels(env as NodeJS.ProcessEnv, existsSync);
  return !r.problems.length && !!r.channels.smtp;
}

function localeFlag(flags: Record<string, string | true>): 'en' | 'el' | 'ru' {
  const locale = str(flags, 'locale', false) ?? 'el';
  if (!['en', 'el', 'ru'].includes(locale)) throw new BootstrapError('--locale is en, el or ru');
  return locale as 'en' | 'el' | 'ru';
}

function printInvite(io: CliIo, email: string, url: string) {
  const live = mailIsLive(io.env);
  io.out(`owner invite for ${email}: ${url}`);
  io.out(live ? 'emailed now. the link works for 14 days and once.' : 'mail is not live, so share the link by hand. it works for 14 days and once.');
}

export async function runCli(db: Db, argv: string[], io: CliIo): Promise<number> {
  const { command, flags } = parseArgs(argv);
  setEmailAssetBase(io.env.CUSTOCK_API_URL);
  switch (command) {
    case 'create-business': {
      const locale = localeFlag(flags);
      const name = str(flags, 'name')!;
      const slug = str(flags, 'slug')!;
      const ownerEmail = str(flags, 'owner-email')!;
      if (flags.invite && flags['set-password']) throw new BootstrapError('--invite or --set-password, not both');
      const invite = flags.invite ? true : flags['set-password'] ? false : mailIsLive(io.env);
      const common = {
        name, slug, ownerEmail, shopName: str(flags, 'shop', false), locale,
        currency: str(flags, 'currency', false), timezone: str(flags, 'timezone', false), country: str(flags, 'country', false),
      };
      if (invite) {
        const webUrl = io.env.CUSTOCK_PUBLIC_WEB_URL;
        if (!webUrl) throw new BootstrapError('the invite link needs CUSTOCK_PUBLIC_WEB_URL');
        const r = createBusiness(db, { ...common, webUrl });
        io.out(`created ${name} (${slug}), org ${r.orgId}${r.shopId ? `, first shop ${r.shopId}` : ''}`);
        printInvite(io, ownerEmail.toLowerCase(), r.inviteUrl!);
        return 0;
      }
      const ownerName = str(flags, 'owner-name')!;
      const { password, generated } = await passwordFrom(flags, io);
      const r = createBusiness(db, { ...common, ownerName, passwordHash: hashPassword(password) });
      io.out(`created ${name} (${slug}), org ${r.orgId}${r.shopId ? `, first shop ${r.shopId}` : ''}`);
      io.out(`owner ${ownerEmail.toLowerCase()} can sign in at /admin`);
      if (generated) io.out(`password (shown once, change it after signing in): ${password}`);
      return 0;
    }
    case 'invite-owner': {
      const slug = str(flags, 'org')!;
      const org = platform(db).get<{ id: string }>('SELECT id FROM organizations WHERE slug = @s', { s: slug });
      if (!org) throw new BootstrapError(`no business with the slug ${slug}`);
      const webUrl = io.env.CUSTOCK_PUBLIC_WEB_URL;
      if (!webUrl) throw new BootstrapError('the invite link needs CUSTOCK_PUBLIC_WEB_URL');
      const email = str(flags, 'email')!.toLowerCase();
      const r = inviteOwner(db, org.id, email, localeFlag(flags), webUrl);
      printInvite(io, email, r.url);
      return 0;
    }
    case 'add-shop': {
      const slug = str(flags, 'org')!;
      const org = platform(db).get<{ id: string }>('SELECT id FROM organizations WHERE slug = @s', { s: slug });
      if (!org) throw new BootstrapError(`no business with the slug ${slug}`);
      const s = addShop(db, org.id, {
        name: str(flags, 'name')!, slug: str(flags, 'slug', false), city: str(flags, 'city', false), address: str(flags, 'address', false), phone: str(flags, 'phone', false),
      }, { id: null, kind: 'system' });
      io.out(`added shop ${s.slug} (${s.id})`);
      return 0;
    }
    case 'set-password': {
      const email = str(flags, 'email')!.toLowerCase();
      const user = platform(db).get<{ id: string }>('SELECT id FROM users WHERE email = @e AND deleted_at IS NULL', { e: email });
      if (!user) throw new BootstrapError(`no account for ${email}`);
      const { password, generated } = await passwordFrom(flags, io);
      const now = Date.now();
      db.transaction(() => {
        platform(db).run('UPDATE users SET password_hash = @h, updated_at = @now WHERE id = @id', { h: hashPassword(password), now, id: user.id });
        // every session ends, the new password is the only way back in
        platform(db).run('UPDATE sessions SET revoked_at = coalesce(revoked_at, @now) WHERE user_id = @u', { now, u: user.id });
        platform(db).run("DELETE FROM auth_throttle WHERE key = @k", { k: `login:${email}` });
      })();
      io.out(`password set for ${email}, every session signed out`);
      if (generated) io.out(`password (shown once): ${password}`);
      return 0;
    }
    default:
      io.out('commands: create-business, invite-owner, add-shop, set-password (see the top of apps/api/src/cli.ts)');
      return command ? 2 : 0;
  }
}

async function readAll(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const isMain = process.argv[1] && /cli\.ts$/.test(process.argv[1]);
if (isMain) {
  const db = openDb(process.env.CUSTOCK_DB ?? DEFAULT_DB_PATH);
  migrate(db);
  runCli(db, process.argv.slice(2), { env: process.env, readStdin: readAll, out: (l) => console.log(l) })
    .then((code) => {
      db.close();
      process.exit(code);
    })
    .catch((err) => {
      db.close();
      console.error(err instanceof BootstrapError ? err.message : err);
      process.exit(1);
    });
}
