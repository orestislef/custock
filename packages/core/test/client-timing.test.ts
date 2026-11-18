// the client protects saves against two people at once and against a retry after the network
// dropped: If-Match from what was loaded, and one Idempotency-Key per create for two minutes.

import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/client';

function fakeServer() {
  const seen: { method: string; url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string, init: { method: string; headers: Record<string, string> }) => {
    seen.push({ method: init.method, url, headers: init.headers });
    if (init.method === 'GET') return new Response(JSON.stringify({ id: 'p1' }), { status: 200, headers: { ETag: 'W/"p-1"', 'Content-Type': 'application/json' } });
    if (init.method === 'PATCH') {
      if (init.headers['If-Match'] === 'W/"p-old"') return new Response(JSON.stringify({ code: 'conflict' }), { status: 412 });
      return new Response(JSON.stringify({ id: 'p1' }), { status: 200, headers: { ETag: 'W/"p-2"' } });
    }
    return new Response(JSON.stringify({ id: 'x' }), { status: 201 });
  }) as unknown as typeof globalThis.fetch;
  return { seen, fetch };
}

describe('client timing', () => {
  it('sends If-Match with the version it loaded and follows the new one after a save', async () => {
    const srv = fakeServer();
    const api = createApiClient({ baseUrl: 'http://x', fetch: srv.fetch });
    await api.product('o1', 'p1');
    await api.updateProduct('o1', 'p1', { brand: 'A' });
    await api.updateProduct('o1', 'p1', { brand: 'B' });
    const patches = srv.seen.filter((r) => r.method === 'PATCH');
    expect(patches[0]!.headers['If-Match']).toBe('W/"p-1"');
    expect(patches[1]!.headers['If-Match']).toBe('W/"p-2"');
  });

  it('a save of something never loaded sends no If-Match', async () => {
    const srv = fakeServer();
    const api = createApiClient({ baseUrl: 'http://x', fetch: srv.fetch });
    await api.updateProduct('o1', 'p9', { brand: 'A' });
    expect(srv.seen[0]!.headers['If-Match']).toBeUndefined();
  });

  it('the same create sent twice carries the same Idempotency-Key, a different one does not', async () => {
    const srv = fakeServer();
    const api = createApiClient({ baseUrl: 'http://x', fetch: srv.fetch });
    const input = { name: 'Tea', variants: [] } as never;
    await api.createProduct('o1', input);
    await api.createProduct('o1', input);
    await api.createProduct('o1', { name: 'Coffee', variants: [] } as never);
    const keys = srv.seen.filter((r) => r.method === 'POST').map((r) => r.headers['Idempotency-Key']);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('a count line or a scan sent twice on purpose gets no key, so both count', async () => {
    const srv = fakeServer();
    const api = createApiClient({ baseUrl: 'http://x', fetch: srv.fetch });
    await api.nextInternalBarcode('o1');
    await api.nextInternalBarcode('o1');
    for (const r of srv.seen) expect(r.headers['Idempotency-Key']).toBeUndefined();
  });

  it('a dropped connection is a TypeError with the network code, and the retry reuses the key', async () => {
    const keys: (string | undefined)[] = [];
    let first = true;
    const fetch = (async (_url: string, init: { headers: Record<string, string> }) => {
      keys.push(init.headers['Idempotency-Key']);
      if (first) { first = false; throw new TypeError('Failed to fetch'); }
      return new Response(JSON.stringify({ id: 'x' }), { status: 201 });
    }) as unknown as typeof globalThis.fetch;
    const api = createApiClient({ baseUrl: 'http://x', fetch });
    const input = { name: 'Tea', variants: [] } as never;
    const e = await api.createProduct('o1', input).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TypeError);
    expect((e as { code?: string }).code).toBe('network');
    await api.createProduct('o1', input);
    expect(keys[1]).toBe(keys[0]);
  });

  it('sign in requests carry no Idempotency-Key', async () => {
    const srv = fakeServer();
    const api = createApiClient({ baseUrl: 'http://x', fetch: srv.fetch });
    await api.login('a@example.com', 'secret-pass-1').catch(() => null);
    expect(srv.seen[0]!.headers['Idempotency-Key']).toBeUndefined();
  });
});
