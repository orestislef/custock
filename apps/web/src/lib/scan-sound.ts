'use client';

// the till beep: a short high tone when a scan counted, a low double tone when the code is not
// known. iphones have no vibration for web apps, so the sound is how a person at the counter knows
// without looking. android also buzzes. browsers only allow sound after a tap on the page, so the
// first tap anywhere unlocks it.

import { buzz } from './scanner';

let ctx: AudioContext | null = null;
let armed = false;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

// call once on the scan page: the first tap or key press lets the page make sound
export function armScanSound() {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const unlock = () => { void audio()?.resume().catch(() => {}); };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}

function tone(c: AudioContext, freq: number, start: number, length: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

export function scanSound(kind: 'ok' | 'miss') {
  buzz(kind === 'ok' ? 12 : 40);
  const c = audio();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime;
  if (kind === 'ok') tone(c, 1760, t, 0.09);
  else { tone(c, 330, t, 0.12); tone(c, 262, t + 0.15, 0.16); }
}
