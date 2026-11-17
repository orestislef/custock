'use client';

import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

// a crisp svg qr code. modules drawn as one path, quiet zone of 4 modules.
export function Qr({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c + 4},${r + 4}h1v1h-1z`;
    return { n: count + 8, d: path };
  }, [value]);
  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges" style={{ background: '#fff', borderRadius: 12 }}>
      <path d={d} fill="#16171B" />
    </svg>
  );
}
