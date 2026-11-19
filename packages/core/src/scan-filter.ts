// which camera reads are real scans. a camera reads the same code many times a second, a shelf
// label carries a barcode and a qr code for one product, and a wide picture catches the
// neighbours on the shelf. the rules:
//
// - only codes inside the aim frame count, the one nearest its middle first, one per picture
// - an item counts once while it stays in the picture. it counts again only after it was out of
//   the picture for gapMs (a moment of not being read while held still is not leaving)
// - once two codes are known to be the same item (the page tells us after looking them up), they
//   share one presence: the qr next to the barcode is not a second item
//
// pure logic, no browser: the camera feeds it what each picture shows.

export interface Box { x: number; y: number; width: number; height: number }
export interface Read { raw: string; format: string; box?: Box }
export interface Aim { x: number; y: number; width: number; height: number }

interface Presence { seen: number; handled: boolean }

export class ScanFilter {
  private readonly items = new Map<string, Presence>();
  private readonly alias = new Map<string, string>();

  constructor(private readonly gapMs = 1500) {}

  private keyOf(raw: string): string {
    return this.alias.get(raw) ?? raw;
  }

  // one picture: the reads in it (already limited to the aim frame) and how far each is from its
  // middle. returns the read to act on, at most one.
  frame(reads: (Read & { distance: number })[], now: number): Read | null {
    const byKey = new Map<string, Read & { distance: number }>();
    for (const r of reads) {
      if (!r.raw) continue;
      const key = this.keyOf(r.raw);
      const best = byKey.get(key);
      if (!best || r.distance < best.distance) byKey.set(key, r);
    }
    let pick: { key: string; read: Read & { distance: number } } | null = null;
    for (const [key, read] of byKey) {
      const p = this.items.get(key);
      // back in the picture after being away: a new appearance
      if (!p || now - p.seen > this.gapMs) this.items.set(key, { seen: now, handled: false });
      else p.seen = now;
      if (!this.items.get(key)!.handled && (!pick || read.distance < pick.read.distance)) pick = { key, read };
    }
    if (pick) this.items.get(pick.key)!.handled = true;
    this.forget(now);
    return pick ? { raw: pick.read.raw, format: pick.read.format, box: pick.read.box } : null;
  }

  // after looking a code up: raw belongs to item. false when that item was already in the picture
  // and counted, so this read is the same item seen through another of its codes.
  claim(raw: string, item: string, at: number): boolean {
    // already known as this item: the picture decided at the item level, once per appearance
    if (this.alias.get(raw) === item) return true;
    const own = this.items.get(raw);
    const known = raw === item ? undefined : this.items.get(item);
    this.alias.set(raw, item);
    if (raw !== item) this.items.delete(raw);
    const seen = Math.max(own?.seen ?? at, known?.seen ?? 0);
    if (known && known.handled && at - known.seen <= this.gapMs) {
      known.seen = seen;
      return false;
    }
    this.items.set(item, { seen, handled: true });
    return true;
  }

  // a fresh start, for a new mode or shop
  reset(): void {
    this.items.clear();
  }

  private forget(now: number) {
    if (this.items.size < 64) return;
    for (const [key, p] of this.items) if (now - p.seen > 60_000) this.items.delete(key);
  }
}

// the part of the camera picture inside the aim frame. the video fills its box like a photo
// (object-fit: cover), so part of the camera picture is cut off and never seen by the person.
// aim is the frame in the box's own pixels; the result is in camera pixels.
export function aimInVideo(video: { width: number; height: number }, box: { width: number; height: number }, aim: Aim): Aim {
  const scale = Math.max(box.width / video.width, box.height / video.height);
  const offX = (video.width - box.width / scale) / 2;
  const offY = (video.height - box.height / scale) / 2;
  return { x: offX + aim.x / scale, y: offY + aim.y / scale, width: aim.width / scale, height: aim.height / scale };
}

// reads whose middle is inside the aim (a little slack around it), with their distance to its middle
export function readsInAim(reads: Read[], aim: Aim, slack = 0.12): (Read & { distance: number })[] {
  const cx = aim.x + aim.width / 2;
  const cy = aim.y + aim.height / 2;
  const halfW = (aim.width / 2) * (1 + slack);
  const halfH = (aim.height / 2) * (1 + slack);
  const out: (Read & { distance: number })[] = [];
  for (const r of reads) {
    // a reader that gives no position: trust it, as if in the middle
    if (!r.box) { out.push({ ...r, distance: 0 }); continue; }
    const mx = r.box.x + r.box.width / 2;
    const my = r.box.y + r.box.height / 2;
    if (Math.abs(mx - cx) > halfW || Math.abs(my - cy) > halfH) continue;
    out.push({ ...r, distance: Math.hypot(mx - cx, my - cy) });
  }
  return out;
}
