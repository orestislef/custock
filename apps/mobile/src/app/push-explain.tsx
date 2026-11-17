// the screen before the system push question: what you will get, and how often.

import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { askForPush } from '@/lib/push';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { usePalette } from '@/ui/theme';

export default function PushExplain() {
  const { t } = useTranslation('mobile');
  const p = usePalette();
  const points = [
    { icon: 'offer' as const, text: t('pushExplain.offers') },
    { icon: 'bell' as const, text: t('pushExplain.backInStock') },
    { icon: 'clock' as const, text: t('pushExplain.limit') },
  ];
  return (
    <ScrollView style={{ backgroundColor: p.elevated }} contentContainerStyle={styles.body}>
      <View style={[styles.badge, { backgroundColor: p.accentTint }]}>
        <Icon name="bell" size={34} color={p.accent} />
      </View>
      <Text variant="title2" display align="center">
        {t('pushExplain.title')}
      </Text>
      <View style={{ gap: 14, alignSelf: 'stretch' }}>
        {points.map((x) => (
          <View key={x.text} style={styles.point}>
            <Icon name={x.icon} size={20} color={p.accent} />
            <Text style={{ flex: 1 }}>{x.text}</Text>
          </View>
        ))}
      </View>
      <View style={{ alignSelf: 'stretch', gap: 6, marginTop: 8 }}>
        <Button title={t('pushExplain.allow')} onPress={() => void askForPush().finally(() => router.back())} />
        <Button title={t('pushExplain.notNow')} kind="plain" onPress={() => router.back()} />
      </View>
      <Text variant="footnote" tone="ink2" align="center">
        {t('pushExplain.footer')}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 24, gap: 18, alignItems: 'center' },
  badge: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  point: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
});
