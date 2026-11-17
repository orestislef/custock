import { LOCALE_NAMES, type AppLocale } from '@custock/i18n';
import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { USING_FIXTURES } from '@/lib/api';
import { useOrg, useSession } from '@/lib/session';
import { Avatar } from '@/ui/Bits';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { usePalette } from '@/ui/theme';

export default function More() {
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const { me, can, signOut, setSide } = useSession();
  const any = (perm: string) => can(perm, null);

  return (
    <>
      <Stack.Screen options={{ title: t('tabs.more') }} />
      <Screen>
        <Section>
          <Row
            title={me?.user.displayName ?? ''}
            subtitle={`${org.roleNames.join(', ')} · ${org.name}`}
            leading={<Avatar name={me?.user.displayName ?? null} size={44} />}
          />
        </Section>

        <Section header={t('more.business')}>
          {any('reports.view') ? <Row icon="chart" iconTint={p.info} title={t('more.reports')} onPress={() => router.push('/(work)/more/reports')} /> : null}
          {any('members.view') ? <Row icon="team" iconTint="#5E7D3A" title={t('more.team')} onPress={() => router.push('/(work)/more/team')} /> : null}
          {any('joinlinks.manage') ? <Row icon="qr" iconTint="#1F8A8A" title={t('more.joinLinks')} onPress={() => router.push('/(work)/more/join-links')} /> : null}
          {can('org.settings.manage') ? <Row icon="shop" title={t('more.customerPage')} subtitle={t('more.customerPageSub')} onPress={() => router.push('/(work)/more/customer-page')} /> : null}
          {!any('reports.view') && !any('members.view') && !any('joinlinks.manage') && !can('org.settings.manage') ? <Row icon="info" iconTint={p.ink2} title={t('more.nothingForRole')} /> : null}
        </Section>

        <Section header={t('more.you')}>
          <Row icon="language" iconTint={p.info} title={t('more.language')} value={LOCALE_NAMES[i18n.language as AppLocale]} onPress={() => router.push('/sheet/language')} />
          {me?.following.length ? <Row icon="swap" iconTint={p.accent} title={t('more.switchToShopper')} onPress={() => { setSide('shopper'); router.replace('/(shopper)/feed'); }} /> : null}
          <Row icon="logout" iconTint={p.ink2} title={t('common:action.signOut')} destructive onPress={() => { void signOut().then(() => router.replace('/sign-in')); }} chevron={false} />
        </Section>

        <View style={{ marginTop: 24, alignItems: 'center', gap: 2 }}>
          <Text variant="footnote" tone="ink2">
            Custock 0.1.0
          </Text>
          {USING_FIXTURES ? (
            <Text variant="caption1" tone="ink3">
              {t('more.demoData')}
            </Text>
          ) : null}
        </View>
      </Screen>
    </>
  );
}
