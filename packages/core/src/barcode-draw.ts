// barcodes as bars, for shelf labels: EAN-13 for 13 digit codes with a valid check digit (our own
// internal codes are EAN-13 too), Code 128 for everything else. the result is a list of module
// runs, starting with a bar, that any renderer (svg, canvas) can draw. no dependencies.

export interface Bars {
  kind: 'ean13' | 'code128';
  // widths in modules, alternating bar, space, bar, ... starting with a bar
  runs: number[];
  // total width in modules, without the quiet zones
  modules: number;
  // the human readable line under the bars
  text: string;
}

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13Valid(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  const d = [...code].map(Number);
  const sum = d.slice(0, 12).reduce((a, x, i) => a + x * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === d[12];
}

function runsOf(bits: string): number[] {
  const out: number[] = [];
  let i = 0;
  // always start with a bar
  if (bits[0] !== '1') throw new Error('bars start with a bar');
  while (i < bits.length) {
    const ch = bits[i];
    let n = 0;
    while (i < bits.length && bits[i] === ch) { n++; i++; }
    out.push(n);
  }
  return out;
}

export function ean13Bars(code: string): Bars {
  if (!ean13Valid(code)) throw new Error('not a valid EAN-13');
  const d = [...code].map(Number);
  const parity = PARITY[d[0]!]!;
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? L : G)[d[i]!]!;
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]!]!;
  bits += '101';
  return { kind: 'ean13', runs: runsOf(bits), modules: bits.length, text: code };
}

// code 128: widths of the 107 symbols (bar, space, bar, space, bar, space), the stop has 7
export const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const;
const START_B = 104;
const START_C = 105;
const STOP = 106;

export function code128Bars(text: string): Bars {
  if (!text.length) throw new Error('nothing to encode');
  const values: number[] = [];
  // digits only, even length: code set C packs two digits per symbol
  if (/^\d+$/.test(text) && text.length % 2 === 0 && text.length >= 4) {
    values.push(START_C);
    for (let i = 0; i < text.length; i += 2) values.push(Number(text.slice(i, i + 2)));
  } else {
    values.push(START_B);
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) throw new Error('code 128 B takes printable ascii only');
      values.push(c - 32);
    }
  }
  const check = values.reduce((a, v, i) => a + v * (i === 0 ? 1 : i), 0) % 103;
  values.push(check, STOP);
  const runs = values.flatMap((v) => [...CODE128[v]!].map(Number));
  return { kind: 'code128', runs, modules: runs.reduce((a, x) => a + x, 0), text };
}

// the right drawing for a code: EAN-13 when it is one, Code 128 otherwise. null when the code has
// characters no shelf scanner reads (then the label shows the QR code only)
export function barsFor(code: string): Bars | null {
  const c = code.trim();
  if (ean13Valid(c)) return ean13Bars(c);
  try {
    return code128Bars(c);
  } catch {
    return null;
  }
}
