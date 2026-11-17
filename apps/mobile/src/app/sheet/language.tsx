import { LOCALE_NAMES, LOCALES } from '@custock/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import { setLocale } from '@/lib/i18n';
import { Icon } from '@/ui/Icon';
import { Row, Section } from '@/ui/List';
import { Text } from '@/ui/Text';
import { usePalette } from '@/ui/theme';

export default function Language() {
  const { t, i18n } = useTranslation('mobile');
  const p = usePalette();
  const qc = useQueryClient();
  return (
    <ScrollView style={{ backgroundColor: p.elevated }} contentContainerStyle={{ paddingVertical: 20 }}>
      <Text variant="title3" weight="700" style={{ marginHorizontal: 20 }}>
        {t('more.language')}
      </Text>
      <Section footer={t('language.footer')}>
        {LOCALES.map((l) => (
          <Row
            key={l}
            title={LOCALE_NAMES[l]}
            trailing={i18n.language === l ? <Icon name="check" size={16} color={p.accent} weight="bold" /> : undefined}
            onPress={() => {
              void setLocale(l).then(() => {
                void qc.invalidateQueries();
                router.back();
              });
            }}
            chevron={false}
          />
        ))}
      </Section>
    </ScrollView>
  );
}
