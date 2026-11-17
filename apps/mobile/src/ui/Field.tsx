import { forwardRef, type ComponentRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { radius, textStyle, usePalette } from './theme';

// a text field row for inset grouped sections
export const FieldRow = forwardRef<ComponentRef<typeof TextInput>, TextInputProps & { label?: string }>(function FieldRow({ label, style, ...rest }, ref) {
  const p = usePalette();
  return (
    <View style={styles.row}>
      {label ? (
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={p.ink3}
        style={[textStyle('body'), { color: p.ink, flex: 1, minHeight: 44, paddingVertical: 10 }, style]}
        accessibilityLabel={label ?? rest.placeholder}
        {...rest}
      />
    </View>
  );
});

// the ios search field: magnifier in a rounded gray capsule
export function SearchField({ value, onChangeText, placeholder, icon = 'search' }: { value: string; onChangeText: (s: string) => void; placeholder: string; icon?: IconName }) {
  const p = usePalette();
  return (
    <View style={[styles.search, { backgroundColor: p.fill }]}>
      <Icon name={icon} size={16} color={p.ink2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={p.ink2}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
        accessibilityRole="search"
        accessibilityLabel={placeholder}
        style={[textStyle('body'), { color: p.ink, flex: 1, paddingVertical: 7 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
  label: { width: 96 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderRadius: radius.m - 2, minHeight: 36 },
});
