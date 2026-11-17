import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { radius, usePalette } from './theme';

type Kind = 'filled' | 'tinted' | 'plain' | 'destructive';

export function Button({
  title, onPress, kind = 'filled', icon, disabled, busy, style, accessibilityHint,
}: { title: string; onPress?: () => void; kind?: Kind; icon?: IconName; disabled?: boolean; busy?: boolean; style?: ViewStyle; accessibilityHint?: string }) {
  const p = usePalette();
  const bg = kind === 'filled' ? p.accentFill : kind === 'tinted' ? p.accentTint : kind === 'destructive' ? p.negTint : 'transparent';
  const fg = kind === 'filled' ? p.onAccent : kind === 'destructive' ? p.negText : p.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.base,
        kind === 'plain' ? styles.plain : null,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      <View style={styles.inner}>
        {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={18} color={fg} weight="semibold" /> : null}
        <Text variant="headline" style={{ color: fg }} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, tint, size = 44 }: { icon: IconName; label: string; onPress: () => void; tint?: string; size?: number }) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: p.fill, opacity: pressed ? 0.7 : 1 }]}
    >
      <Icon name={icon} size={20} color={tint ?? p.ink} weight="semibold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 50, borderRadius: radius.m + 2, paddingHorizontal: 20, justifyContent: 'center' },
  plain: { minHeight: 44 },
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
