// the stack inside each tab: ios large titles that collapse into the bar on scroll, accent back
// buttons, the shelf color behind everything.

import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';

import { useSession } from '@/lib/session';
import { Icon } from './Icon';
import { Text } from './Text';
import { usePalette } from './theme';

export function TabStack() {
  const p = usePalette();
  return (
    <Stack
      screenOptions={{
        headerLargeTitleEnabled: true,
        headerTransparent: Platform.OS === 'ios',
        headerBlurEffect: Platform.OS === 'ios' ? 'systemChromeMaterial' : undefined,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerLargeStyle: { backgroundColor: Platform.OS === 'ios' ? 'transparent' : p.shelf },
        headerStyle: Platform.OS === 'ios' ? undefined : { backgroundColor: p.shelf },
        headerTintColor: p.accent,
        headerTitleStyle: { color: p.ink },
        headerLargeTitleStyle: { color: p.ink },
        contentStyle: { backgroundColor: p.shelf },
        // web preview only: the web tab bar floats at the top, so the header starts below it
        ...(Platform.OS === 'web' ? { headerStatusBarHeight: 76, headerTitleAlign: 'left' as const, headerTitleStyle: { color: p.ink, fontSize: 28, fontWeight: '700' as const } } : null),
      }}
    />
  );
}

// "Kifisia v" in the header. only when the member sees more than one shop.
export function ShopSwitch() {
  const { t } = useTranslation('common');
  const p = usePalette();
  const { org, shopId } = useSession();
  if (!org || org.shops.length < 2) return null;
  const name = shopId ? org.shops.find((s) => s.shopId === shopId)?.name.replace(/^.*\s/, '') : t('scope.allShops');
  return (
    <Pressable
      onPress={() => router.push('/shop-picker')}
      accessibilityRole="button"
      accessibilityLabel={`${t('scope.shop')}: ${name}`}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, minHeight: 32, borderRadius: 16, backgroundColor: p.fill }}>
        <Icon name="shop" size={14} color={p.accent} />
        <Text variant="subheadline" weight="600" tone="accent" numberOfLines={1} style={{ maxWidth: 140 }}>
          {name}
        </Text>
        <Icon name="chevron" size={10} color={p.accent} weight="bold" />
      </View>
    </Pressable>
  );
}
