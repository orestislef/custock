// small shared pieces: empty states, tips, "why not" lines, avatars, chips, cards, segmented control.

import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { radius, usePalette } from './theme';

export function EmptyState({ icon, title, body, action, onAction }: { icon: IconName; title: string; body: string; action?: string; onAction?: () => void }) {
  const p = usePalette();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: p.fill }]}>
        <Icon name={icon} size={30} color={p.ink2} />
      </View>
      <Text variant="title3" display align="center">
        {title}
      </Text>
      <Text tone="ink2" align="center">
        {body}
      </Text>
      {action && onAction ? <Button title={action} onPress={onAction} kind="tinted" style={{ marginTop: 8, alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

// shown once next to the thing it explains. the caller decides when it was seen.
export function Tip({ text, onClose, closeLabel }: { text: string; onClose: () => void; closeLabel: string }) {
  const p = usePalette();
  return (
    <View style={[styles.tip, { backgroundColor: p.accentTint }]}>
      <Icon name="info" size={18} color={p.accent} />
      <Text variant="subheadline" style={{ flex: 1 }}>
        {text}
      </Text>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} hitSlop={12}>
        <Icon name="close" size={14} color={p.ink2} weight="semibold" />
      </Pressable>
    </View>
  );
}

export function useTip(): [boolean, () => void] {
  const [open, setOpen] = useState(true);
  return [open, () => setOpen(false)];
}

// one line that explains why something is locked or hidden
export function WhyNot({ text, icon = 'lock' }: { text: string; icon?: IconName }) {
  const p = usePalette();
  return (
    <View style={styles.why}>
      <Icon name={icon} size={12} color={p.ink2} />
      <Text variant="footnote" tone="ink2" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

export function Avatar({ name, size = 36 }: { name: string | null; size?: number }) {
  const p = usePalette();
  const initials = (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: p.accentTint, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="footnote" weight="600" tone="accent">
        {initials}
      </Text>
    </View>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? p.accentFill : p.fill, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={selected ? p.onAccent : p.ink} /> : null}
      <Text variant="subheadline" weight="600" style={{ color: selected ? p.onAccent : p.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Card({ children, style, onPress, label }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; label?: string }) {
  const p = usePalette();
  const body = <View style={[styles.card, { backgroundColor: p.surface }, style]}>{children}</View>;
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      {body}
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const p = usePalette();
  return (
    <View style={[styles.segmented, { backgroundColor: p.fill }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segment, on && { backgroundColor: p.elevated, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 }]}
          >
            <Text variant="footnote" weight={on ? '600' : '500'} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Pill({ text, tone = 'accent', icon }: { text: string; tone?: 'accent' | 'info' | 'success' | 'few'; icon?: IconName }) {
  const p = usePalette();
  const map = {
    accent: { fg: p.accent, bg: p.accentTint },
    info: { fg: p.info, bg: p.fill },
    success: { fg: p.success, bg: p.fill },
    few: { fg: p.fewText, bg: p.fewTint },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: map.bg }]}>
      {icon ? <Icon name={icon} size={12} color={map.fg} weight="semibold" /> : null}
      <Text variant="caption1" weight="600" style={{ color: map.fg }}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 10, paddingHorizontal: 32, paddingVertical: 48 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  tip: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: radius.m, marginHorizontal: 16, marginTop: 16 },
  why: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  chip: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 14, minHeight: 34, borderRadius: 999 },
  card: { borderRadius: radius.l, overflow: 'hidden' },
  segmented: { flexDirection: 'row', borderRadius: 9, padding: 2, gap: 2 },
  segment: { flex: 1, minHeight: 32, borderRadius: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
});
