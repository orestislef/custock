// theme from @custock/tokens. the app follows the system light or dark setting, no in app switch.

import { colors, radius, space, type as textStyles } from '@custock/tokens';
import { Platform, useColorScheme, type TextStyle } from 'react-native';

export type Palette = { [K in keyof (typeof colors)['light']]: string };

export function usePalette(): Palette {
  const scheme = useColorScheme();
  return scheme === 'dark' ? colors.dark : colors.light;
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}

export type TextVariant = keyof typeof textStyles;

// ios text styles. android gets the same sizes, roboto renders them close enough.
export function textStyle(variant: TextVariant): TextStyle {
  const s = textStyles[variant];
  return {
    fontSize: s.size,
    lineHeight: s.line,
    fontWeight: s.weight as TextStyle['fontWeight'],
    letterSpacing: Platform.OS === 'ios' ? s.tracking : 0,
  };
}

// commissioner is the display face. it is only used when the font loaded, see fonts.ts
export const DISPLAY_FONT = 'Commissioner';

export { radius, space };
