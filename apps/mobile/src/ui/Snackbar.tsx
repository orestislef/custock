// bottom snackbar for undo and short confirmations. stays 10 seconds when it offers undo.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

interface Snack { id: number; text: string; icon?: IconName; actionLabel?: string; onAction?: () => void }

const Ctx = createContext<(s: Omit<Snack, 'id'>) => void>(() => {});

export function useSnackbar() {
  return useContext(Ctx);
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snack, setSnack] = useState<Snack | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();

  const show = useCallback((s: Omit<Snack, 'id'>) => {
    if (timer.current) clearTimeout(timer.current);
    const next = { ...s, id: Date.now() };
    setSnack(next);
    timer.current = setTimeout(() => setSnack((cur) => (cur?.id === next.id ? null : cur)), s.onAction ? 10000 : 3500);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <Ctx.Provider value={show}>
      {children}
      {snack ? (
        <Animated.View
          key={snack.id}
          entering={reduce ? undefined : FadeInDown.duration(220)}
          exiting={reduce ? undefined : FadeOutDown.duration(180)}
          pointerEvents="box-none"
          style={[styles.wrap, { bottom: insets.bottom + 96 }]}
        >
          <View style={styles.bar} accessibilityLiveRegion="polite" accessibilityRole="alert">
            {snack.icon ? <Icon name={snack.icon} size={18} color="#FFFFFF" /> : null}
            <Text variant="subheadline" style={{ color: '#FFFFFF', flex: 1 }} numberOfLines={2}>
              {snack.text}
            </Text>
            {snack.actionLabel && snack.onAction ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => {
                  snack.onAction?.();
                  setSnack(null);
                }}
              >
                <Text variant="subheadline" weight="700" style={{ color: '#FF8FAB' }}>
                  {snack.actionLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 14, backgroundColor: 'rgba(30,30,34,0.94)', maxWidth: 560, width: '100%',
  },
});
