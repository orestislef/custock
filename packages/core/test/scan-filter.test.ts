// the camera rules played out as a person would use them: a picture every 120 ms, codes coming and
// going, a shelf label with a barcode and a qr code, neighbours in the picture, slow lookups.

import { describe, expect, it } from 'vitest';
import { ScanFilter, aimInVideo, readsInAim, type Read } from '../src/index';

const EAN = '5201234567894';
const QR = 'https://custock.example.com/p/oil';
const OTHER = '5200000000014';
const STEP = 120;

const at = (raw: string, distance = 0, format = raw.startsWith('http') ? 'qr_code' : 'ean_13') => ({ raw, format, distance });

// plays pictures and returns what the camera would hand to the page, with the time
function play(f: ScanFilter, pictures: ReturnType<typeof at>[][], start = 0) {
  const out: { raw: string; t: number }[] = [];
  pictures.forEach((reads, i) => {
    const t = start + i * STEP;
    const r = f.frame(reads, t);
    if (r) out.push({ raw: r.raw, t });
  });
  return out;
}
const hold = (reads: ReturnType<typeof at>[], ms: number) => Array.from({ length: Math.round(ms / STEP) }, () => reads);

describe('scan filter: what counts as a scan', () => {
  it('a code held still for 5 seconds is one scan', () => {
    const f = new ScanFilter(1500);
    expect(play(f, hold([at(EAN)], 5000))).toHaveLength(1);
  });

  it('a code that is not read for a moment while held still is still one scan', () => {
    const f = new ScanFilter(1500);
    // read, then 1 second of nothing (glare, focus), then read again
    const pics = [...hold([at(EAN)], 1000), ...hold([], 1000), ...hold([at(EAN)], 1000)];
    expect(play(f, pics)).toHaveLength(1);
  });

  it('taken away for 2 seconds and shown again is a second scan', () => {
    const f = new ScanFilter(1500);
    const pics = [...hold([at(EAN)], 1000), ...hold([], 2000), ...hold([at(EAN)], 1000)];
    expect(play(f, pics)).toHaveLength(2);
  });

  it('a barcode and a qr code read in turns, frame by frame, is one scan for each code at most', () => {
    const f = new ScanFilter(1500);
    // the reader returns one of them per picture, in turns: this is what sold 4 in the live test
    const pics = Array.from({ length: 40 }, (_, i) => [i % 2 ? at(QR) : at(EAN)]);
    const out = play(f, pics);
    expect(out.map((o) => o.raw)).toEqual([EAN, QR]);
  });

  it('once the page knows both codes are the same product, the label is one scan', () => {
    const f = new ScanFilter(1500);
    const first = f.frame([at(EAN), at(QR, 30)], 0);
    expect(first?.raw).toBe(EAN);
    // the page looks the barcode up: a new item, it counts
    expect(f.claim(EAN, 'oil:1', 40)).toBe(true);
    // the next picture hands over the qr code, the page finds the same product: not a second item
    const second = f.frame([at(EAN), at(QR, 30)], STEP);
    expect(second?.raw).toBe(QR);
    expect(f.claim(QR, 'oil:1', STEP)).toBe(false);
    // held on: nothing more
    expect(play(f, hold([at(EAN), at(QR, 30)], 3000), 2 * STEP)).toHaveLength(0);
    // away and back: one scan for the label, whichever code comes first
    const back = play(f, [...hold([], 2000), ...hold([at(QR), at(EAN, 30)], 1000)], 4000);
    expect(back).toHaveLength(1);
    expect(f.claim(back[0]!.raw, 'oil:1', back[0]!.t)).toBe(true);
  });

  it('a slow lookup: the qr code waits in line behind the barcode and is still the same item', () => {
    const f = new ScanFilter(1500);
    const reads = [at(EAN), at(QR, 30)];
    const out = play(f, hold(reads, 600));
    expect(out.map((o) => o.raw)).toEqual([EAN, QR]);
    // the answers come back late and in order
    expect(f.claim(EAN, 'oil:1', out[0]!.t)).toBe(true);
    expect(f.claim(QR, 'oil:1', out[1]!.t)).toBe(false);
  });

  it('two different products in the frame are two scans, nearest the middle first', () => {
    const f = new ScanFilter(1500);
    const out = play(f, hold([at(OTHER, 80), at(EAN, 10)], 1000));
    expect(out.map((o) => o.raw)).toEqual([EAN, OTHER]);
  });

  it('two different products one after the other, quickly, are two scans', () => {
    const f = new ScanFilter(1500);
    const out = play(f, [...hold([at(EAN)], 360), ...hold([at(OTHER)], 360)]);
    expect(out.map((o) => o.raw)).toEqual([EAN, OTHER]);
  });

  it('a pack code and a unit code of one product are different items', () => {
    const f = new ScanFilter(1500);
    const carton = '15201234567891';
    expect(f.frame([at(EAN)], 0)?.raw).toBe(EAN);
    expect(f.claim(EAN, 'oil:1', 0)).toBe(true);
    expect(f.frame([at(EAN), at(carton, 40, 'itf')], STEP)?.raw).toBe(carton);
    expect(f.claim(carton, 'oil:6', STEP)).toBe(true);
  });
});

describe('scan filter: the aim frame', () => {
  const box = (cx: number, cy: number): Read['box'] => ({ x: cx - 40, y: cy - 15, width: 80, height: 30 });

  it('only codes inside the frame count, with a little slack', () => {
    const aim = { x: 100, y: 100, width: 400, height: 250 };
    const reads: Read[] = [
      { raw: 'middle', format: 'ean_13', box: box(300, 225) },
      { raw: 'edge-in', format: 'ean_13', box: box(510, 225) },
      { raw: 'outside', format: 'ean_13', box: box(650, 225) },
      { raw: 'above', format: 'ean_13', box: box(300, 40) },
      { raw: 'no-box', format: 'ean_13' },
    ];
    const got = readsInAim(reads, aim).map((r) => r.raw).sort();
    expect(got).toEqual(['edge-in', 'middle', 'no-box']);
  });

  it('the frame on screen maps to the camera picture, with the cut off sides of a cover fit', () => {
    // a 1280x720 camera shown in a 400x400 box: the sides are cut off
    const a = aimInVideo({ width: 1280, height: 720 }, { width: 400, height: 400 }, { x: 50, y: 100, width: 300, height: 200 });
    // scale is 720/400 = 1.8 the other way; the visible part starts at (1280 - 720) / 2 = 280
    expect(a.x).toBeCloseTo(280 + 50 * 1.8);
    expect(a.y).toBeCloseTo(100 * 1.8);
    expect(a.width).toBeCloseTo(300 * 1.8);
    expect(a.height).toBeCloseTo(200 * 1.8);
  });
});
