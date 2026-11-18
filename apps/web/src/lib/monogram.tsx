import 'server-only';

// the home screen icon of a business without a logo: its first letter on the accent colour, in the
// display face (greek and cyrillic included). made on the server with next/og.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { colors } from '@custock/tokens';

const font = readFile(join(process.cwd(), 'assets', 'fonts', 'Commissioner-SemiBold.ttf'));

export async function monogram(name: string, size: number, maskable = false): Promise<ImageResponse> {
  const letter = [...name.trim()][0]?.toLocaleUpperCase() ?? 'C';
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.light.accent }}>
        <div style={{ color: '#FFFFFF', fontSize: size * (maskable ? 0.42 : 0.56), fontFamily: 'Commissioner', lineHeight: 1, marginTop: size * 0.02 }}>{letter}</div>
      </div>
    ),
    { width: size, height: size, fonts: [{ name: 'Commissioner', data: await font, weight: 600, style: 'normal' }], headers: { 'Cache-Control': 'public, max-age=86400' } },
  );
}
