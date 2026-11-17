import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View, type ScrollViewProps } from 'react-native';

import { usePalette } from './theme';

// a scrolling screen under a native header. contentInsetAdjustmentBehavior lets the ios large
// title collapse on scroll the way system apps do.
export function Screen({ children, refreshing, onRefresh, ...rest }: ScrollViewProps & { children?: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const p = usePalette();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      style={{ flex: 1, backgroundColor: p.shelf }}
      contentContainerStyle={{ paddingBottom: 48 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

export function Fill({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <View style={{ flex: 1, backgroundColor: p.shelf }}>{children}</View>;
}
