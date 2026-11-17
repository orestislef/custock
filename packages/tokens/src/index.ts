// design tokens for web and phone. values and contrast ratios are in thinking/10-design.md.

export const colors = {
  light: {
    shelf: '#F3F3F0',
    surface: '#FFFFFF',
    elevated: '#FFFFFF',
    ink: '#16171B',
    ink2: '#5E6068',
    ink3: '#74767E',
    line: '#E3E3DE',
    fill: 'rgba(118,118,128,0.12)',
    accent: '#B0234F',
    accentFill: '#B0234F',
    onAccent: '#FFFFFF',
    accentTint: '#F9E6EC',
    fewText: '#7A4A00',
    fewTint: '#FFF1D6',
    outText: '#55575E',
    outTint: '#ECECE8',
    negText: '#A11B1B',
    negTint: '#FDE7E7',
    error: '#C42B2B',
    success: '#1E7A44',
    info: '#2F5BC8',
    scrim: 'rgba(0,0,0,0.32)',
  },
  dark: {
    shelf: '#0F0F12',
    surface: '#1A1A1F',
    elevated: '#232329',
    ink: '#F2F1EE',
    ink2: '#A3A3AD',
    ink3: '#8C8C96',
    line: '#2E2E35',
    fill: 'rgba(118,118,128,0.24)',
    accent: '#FF6B8E',
    accentFill: '#C42A58',
    onAccent: '#FFFFFF',
    accentTint: '#3A1622',
    fewText: '#F5C76B',
    fewTint: '#33270F',
    outText: '#B4B4BC',
    outTint: '#2A2A30',
    negText: '#FF7A70',
    negTint: '#3A1414',
    error: '#FF7A70',
    success: '#5BD08A',
    info: '#8AA8FF',
    scrim: 'rgba(0,0,0,0.5)',
  },
} as const;

export type ColorScheme = keyof typeof colors;
export type ColorToken = keyof (typeof colors)['light'];

// one categorical palette for every chart, accent first
export const chart = ['#B0234F', '#2F5BC8', '#C98A1B', '#5E7D3A', '#1F8A8A', '#7B4FA0', '#6B7280'] as const;

// ios text styles, size / line height in points
export const type = {
  largeTitle: { size: 34, line: 41, weight: '700', tracking: 0.4 },
  title1: { size: 28, line: 34, weight: '700', tracking: 0.38 },
  title2: { size: 22, line: 28, weight: '700', tracking: -0.26 },
  title3: { size: 20, line: 25, weight: '600', tracking: -0.45 },
  headline: { size: 17, line: 22, weight: '600', tracking: -0.43 },
  body: { size: 17, line: 22, weight: '400', tracking: -0.43 },
  callout: { size: 16, line: 21, weight: '400', tracking: -0.31 },
  subheadline: { size: 15, line: 20, weight: '400', tracking: -0.23 },
  footnote: { size: 13, line: 18, weight: '400', tracking: -0.08 },
  caption1: { size: 12, line: 16, weight: '400', tracking: 0 },
  caption2: { size: 11, line: 13, weight: '400', tracking: 0.06 },
} as const;

export const fonts = {
  display: 'Commissioner',
  ui: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, "Segoe UI", Roboto, sans-serif',
} as const;

export const space = { xxs: 2, xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const radius = { s: 8, m: 12, l: 16, xl: 20, sheet: 28, pill: 999 } as const;

export const control = { minTarget: 44, buttonHeight: 50, rowHeight: 44, tabBarHeight: 64 } as const;

// ios like curves and durations
export const motion = {
  push: { duration: 350, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
  sheet: { duration: 450, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
  tally: { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  fade: { duration: 200, easing: 'ease-out' },
  spring: { damping: 22, stiffness: 260, mass: 1 },
} as const;

// css custom properties for the web, one block per scheme
export function cssVariables(scheme: ColorScheme): string {
  const c = colors[scheme];
  return Object.entries(c)
    .map(([k, v]) => `--c-${k.replace(/[A-Z0-9]/g, (m) => '-' + m.toLowerCase())}: ${v};`)
    .join('\n');
}
