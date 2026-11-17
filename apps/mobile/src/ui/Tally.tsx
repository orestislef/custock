// the signature: stock numbers roll like a hand tally counter when they change.
// with reduce motion on, digits just swap.

import { motion } from '@custock/tokens';
import { useEffect } from 'react';
import { Platform, StyleSheet, View, type TextStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { useDisplayFontReady } from '@/lib/fonts';
import { Text } from './Text';
import { DISPLAY_FONT, textStyle, usePalette, type TextVariant } from './theme';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function DigitColumn({ digit, height, style }: { digit: number; height: number; style: TextStyle }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(-digit * height);
  useEffect(() => {
    y.value = reduce
      ? -digit * height
      : withTiming(-digit * height, { duration: motion.tally.duration, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
  }, [digit, height, reduce, y]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <View style={{ height, overflow: 'hidden' }}>
      <Animated.View style={[{ alignItems: 'center' }, animated]}>
        {DIGITS.map((d) => (
          <Animated.Text key={d} style={[style, { height, lineHeight: height, textAlign: 'center' }]}>
            {d}
          </Animated.Text>
        ))}
      </Animated.View>
    </View>
  );
}

export function Tally({ value, format, variant = 'title2', color, display = true, accessibilityLabel }: {
  value: number;
  format?: (n: number) => string;
  variant?: TextVariant;
  color?: string;
  display?: boolean;
  accessibilityLabel?: string;
}) {
  const p = usePalette();
  const fontReady = useDisplayFontReady();
  const text = format ? format(value) : String(value);
  const base = textStyle(variant);
  const height = base.lineHeight ?? 22;
  const style: TextStyle = {
    ...base,
    color: color ?? p.ink,
    fontVariant: ['tabular-nums'],
    ...(display && fontReady ? { fontFamily: DISPLAY_FONT, ...(Platform.OS === 'android' ? { fontWeight: 'normal' as const } : null) } : null),
  };
  return (
    <View style={styles.row} accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel ?? text}>
      {text.split('').map((ch, i) =>
        /\d/.test(ch) ? (
          <DigitColumn key={`${i}-${text.length}`} digit={Number(ch)} height={height} style={style} />
        ) : (
          <Text key={`${i}-${ch}`} style={[style, { height, lineHeight: height }]}>
            {ch}
          </Text>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'flex-start' } });
