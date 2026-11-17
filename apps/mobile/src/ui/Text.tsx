import { Platform, Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { useDisplayFontReady } from '@/lib/fonts';
import { DISPLAY_FONT, textStyle, usePalette, type TextVariant } from './theme';

type Tone = 'ink' | 'ink2' | 'ink3' | 'accent' | 'error' | 'success' | 'info' | 'onAccent';

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: Tone;
  display?: boolean; // use the display face for this text
  tabular?: boolean; // numbers that line up
  weight?: TextStyle['fontWeight'];
  align?: TextStyle['textAlign'];
}

export function Text({ variant = 'body', tone = 'ink', display, tabular, weight, align, style, ...rest }: AppTextProps) {
  const p = usePalette();
  const fontReady = useDisplayFontReady();
  return (
    <RNText
      maxFontSizeMultiplier={2.4}
      style={[
        textStyle(variant),
        { color: p[tone] },
        // the bold file is the weight, so android must not fake bold on top of it
        display && fontReady ? { fontFamily: DISPLAY_FONT, ...(Platform.OS === 'android' ? { fontWeight: 'normal' as const } : null) } : null,
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        weight ? { fontWeight: weight } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    />
  );
}
