// the join page in the app: who you are joining, what you will get, channels unticked by default.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api, errorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { EmptyState, WhyNot } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { useSnackbar } from '@/ui/Snackbar';
import { Text } from '@/ui/Text';
import { Toggle } from '@/ui/Toggle';
import { usePalette } from '@/ui/theme';

export default function JoinPage() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { t } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const qc = useQueryClient();
  const snack = useSnackbar();
  const { me, refresh } = useSession();
  const res = useQuery({ queryKey: ['joinPage', code], queryFn: () => api.joinPage(code) });
  const [emailNews, setEmailNews] = useState(false);
  const [push, setPush] = useState(false);
  const [over15, setOver15] = useState(false);
  const [busy, setBusy] = useState(false);
  const page = res.data;

  if (res.isError) return <Screen><EmptyState icon="qr" title={t('join.notFoundTitle')} body={t('common:error.join_link_disabled')} /></Screen>;
  if (!page) return <Screen />;

  async function join() {
    setBusy(true);
    try {
      // signed in customers join with their account; the web join page covers people without one
      await api.joinAsCustomer(code, { emailNews, push });
      await refresh();
      void qc.invalidateQueries();
      snack({ text: t('join.done', { name: page!.scopeName }), icon: 'checkCircle' });
      router.dismissTo('/(shopper)/shops');
      if (push) router.push('/push-explain');
    } catch (e) {
      snack({ text: t(`common:error.${errorCode(e)}`), icon: 'warning' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: page.scopeName, headerLargeTitleEnabled: false }} />
      <Screen keyboardShouldPersistTaps="handled">
        {page.imageUrl ? <Image source={page.imageUrl} style={{ height: 180, marginHorizontal: 16, marginTop: 8, borderRadius: 20 }} contentFit="cover" /> : null}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 6 }}>
          <Text variant="title2" display>
            {t('join.heading', { name: page.scopeName })}
          </Text>
          <Text tone="ink2">{t('join.what')}</Text>
        </View>
        {page.disabled ? (
          <View style={{ margin: 16 }}>
            <WhyNot icon="warning" text={t('common:error.join_link_disabled')} />
          </View>
        ) : (
          <>
            <Section header={t('join.you')}>
              <Row icon="person" iconTint={p.ink2} title={me?.user.displayName ?? ''} subtitle={me?.user.email ?? undefined} />
            </Section>
            <Section header={t('join.channels')} footer={t('join.channelsFooter')}>
              <Row icon="mail" iconTint={p.info} title={t('join.emailNews')} trailing={<Toggle value={emailNews} onValueChange={setEmailNews} />} />
              <Row icon="bell" title={t('join.push')} subtitle={t('join.pushSub')} trailing={<Toggle value={push} onValueChange={setPush} />} />
            </Section>
            <Section footer={t('join.privacy', { org: page.orgName })}>
              <Row title={t('join.over15')} trailing={<Toggle value={over15} onValueChange={setOver15} />} />
            </Section>
            <Button title={t('join.cta', { name: page.scopeName })} onPress={() => void join()} busy={busy} disabled={!over15} style={{ marginHorizontal: 16, marginTop: 16 }} />
          </>
        )}
      </Screen>
    </>
  );
}
