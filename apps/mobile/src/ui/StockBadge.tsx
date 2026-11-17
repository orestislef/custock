// stock states. the normal state has no color. exceptions get color, an icon and a word.

import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';
import { usePalette } from './theme';

export type StockState = 'in' | 'few' | 'out' | 'negative' | 'onTheWay';

export function stockState(onHand: number, reorderPoint: number | null, fewThreshold = 3): StockState {
  if (onHand < 0) return 'negative';
  if (onHand === 0) return 'out';
  if (onHand <= (reorderPoint ?? fewThreshold)) return 'few';
  return 'in';
}

export function StockBadge({ state, compact }: { state: StockState; compact?: boolean }) {
  const { t } = useTranslation('common');
  const p = usePalette();
  if (state === 'in') return null;
  const look = {
    few: { fg: p.fewText, bg: p.fewTint, icon: 'few' as const },
    out: { fg: p.outText, bg: p.outTint, icon: 'out' as const },
    negative: { fg: p.negText, bg: p.negTint, icon: 'warning' as const },
    onTheWay: { fg: p.info, bg: p.fill, icon: 'truck' as const },
  }[state];
  return (
    <View style={[styles.badge, { backgroundColor: look.bg }]}>
      <Icon name={look.icon} size={12} color={look.fg} weight="semibold" />
      {!compact ? (
        <Text variant="caption1" weight="600" style={{ color: look.fg }}>
          {t(`stock.${state}`)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
});
