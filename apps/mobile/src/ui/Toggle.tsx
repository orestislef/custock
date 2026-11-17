import { Platform, Switch } from 'react-native';

import { usePalette } from './theme';

// the system switch, tinted with the accent. white thumb off ios, like the platform default look.
export function Toggle({ value, onValueChange, disabled, label }: { value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  const p = usePalette();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={label}
      trackColor={{ true: p.accentFill, false: p.fill }}
      thumbColor={Platform.OS === 'ios' ? undefined : '#FFFFFF'}
      ios_backgroundColor={p.fill}
    />
  );
}
