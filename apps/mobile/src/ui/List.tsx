// inset grouped lists, the ios way: rounded sections on the shelf color, hairline separators
// inset from the leading edge, headers and footers in footnote style.

import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { radius, usePalette } from './theme';

export function Section({ header, footer, children, style }: { header?: string; footer?: ReactNode; children: ReactNode; style?: ViewStyle }) {
  const p = usePalette();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.section, style]}>
      {header ? (
        <Text variant="footnote" tone="ink2" style={styles.header} accessibilityRole="header">
          {header}
        </Text>
      ) : null}
      <View style={[styles.group, { backgroundColor: p.surface }]}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {child}
            {i < items.length - 1 ? <View style={[styles.separator, { backgroundColor: p.line }]} /> : null}
          </Fragment>
        ))}
      </View>
      {footer ? (
        typeof footer === 'string' ? (
          <Text variant="footnote" tone="ink2" style={styles.footer}>
            {footer}
          </Text>
        ) : (
          <View style={styles.footer}>{footer}</View>
        )
      ) : null}
    </View>
  );
}

export interface RowProps {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: IconName;
  iconTint?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}

export function Row({ title, subtitle, value, icon, iconTint, leading, trailing, onPress, chevron, destructive, disabled, accessibilityHint }: RowProps) {
  const p = usePalette();
  const content = (
    <View style={[styles.row, disabled && { opacity: 0.45 }]}>
      {leading ?? (icon ? (
        <View style={[styles.iconTile, { backgroundColor: iconTint ?? p.accent }]}>
          <Icon name={icon} size={17} color="#FFFFFF" />
        </View>
      ) : null)}
      <View style={styles.rowText}>
        <Text tone={destructive ? 'error' : 'ink'} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="subheadline" tone="ink2" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text tone="ink2" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {chevron ?? !!onPress ? <Icon name="chevron" size={14} color={p.ink3} weight="semibold" /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [pressed && { backgroundColor: p.fill }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginHorizontal: 16, marginTop: 24 },
  header: { textTransform: 'none', marginHorizontal: 16, marginBottom: 6 },
  footer: { marginHorizontal: 16, marginTop: 6 },
  group: { borderRadius: radius.m, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  row: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, gap: 2 },
  value: { maxWidth: '45%' },
  iconTile: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
});
