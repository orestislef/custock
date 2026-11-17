// the one orchestrated moment: stock meets customers. "14 waiting" turns into "14 told" and small
// dots fly out toward the people who asked. with reduce motion it is a simple fade.

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';

import { Icon } from './Icon';
import { Text } from './Text';
import { usePalette } from './theme';

function Dot({ i, total, color }: { i: number; total: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(260 + i * 40, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [i, t]);
  const angle = (i / total) * Math.PI * 2;
  const style = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    transform: [{ translateX: Math.cos(angle) * 120 * t.value }, { translateY: Math.sin(angle) * 120 * t.value }, { scale: 1 - t.value * 0.4 }],
  }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

export function BackInStockMoment({ count, productName, onDone }: { count: number; productName: string; onDone: () => void }) {
  const { t } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const reduce = useReducedMotion();
  const flip = useSharedValue(0);
  useEffect(() => {
    flip.value = withDelay(200, withTiming(1, { duration: 260 }));
    const id = setTimeout(onDone, reduce ? 1800 : 2400);
    return () => clearTimeout(id);
  }, [flip, onDone, reduce]);
  const waitingStyle = useAnimatedStyle(() => ({ opacity: 1 - flip.value, transform: [{ translateY: -10 * flip.value }] }));
  const toldStyle = useAnimatedStyle(() => ({ opacity: flip.value, transform: [{ translateY: 10 * (1 - flip.value) }] }));
  const dots = Math.min(count, 18);
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(220)} style={[StyleSheet.absoluteFill, styles.scrim, { backgroundColor: p.scrim }]} accessibilityLiveRegion="assertive" accessibilityLabel={t('common:stock.told', { count })}>
      <View style={[styles.card, { backgroundColor: p.elevated }]}>
        <View style={styles.center}>
          {!reduce ? Array.from({ length: dots }, (_, i) => <Dot key={i} i={i} total={dots} color={p.accent} />) : null}
          <View style={[styles.bell, { backgroundColor: p.accentTint }]}>
            <Icon name="bell" size={30} color={p.accent} />
          </View>
        </View>
        <Text variant="headline" align="center" numberOfLines={2}>
          {productName}
        </Text>
        <View style={{ height: 30, alignSelf: 'stretch' }}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, waitingStyle]}>
            <Text variant="title3" display tone="ink2">
              {t('common:stock.waiting', { count })}
            </Text>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, toldStyle]}>
            <Text variant="title3" display tone="accent">
              {t('common:stock.told', { count })}
            </Text>
          </Animated.View>
        </View>
        <Text variant="footnote" tone="ink2" align="center">
          {t('scan.backInStockBody')}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { alignItems: 'center', justifyContent: 'center', padding: 32, zIndex: 50 },
  card: { width: '100%', maxWidth: 340, borderRadius: 28, padding: 24, gap: 10, alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  bell: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginVertical: 12 },
  dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
});
