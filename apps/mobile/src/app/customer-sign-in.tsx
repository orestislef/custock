// customers sign in without a password: an email code. in development the code is shown on screen,
// nothing is emailed.

import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api, errorCode } from '@/lib/api';
import { currentLocale } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Button } from '@/ui/Button';
import { WhyNot } from '@/ui/Bits';
import { FieldRow } from '@/ui/Field';
import { Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';

export default function CustomerSignIn() {
  const { t } = useTranslation(['mobile', 'common']);
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestOtp(email, currentLocale());
      setSent(true);
      setDevCode(r.devCode ?? null);
    } catch (e) {
      setError(t(`common:error.${errorCode(e)}`));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await signIn(await api.verifyOtp(email, code));
      router.dismissAll();
      router.replace('/');
    } catch (e) {
      setError(t(`common:error.${errorCode(e)}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('customerSignIn.title') }} />
      <Screen>
        <View style={{ paddingHorizontal: 32, paddingTop: 24, gap: 8 }}>
          <Text variant="title2" display>
            {t('customerSignIn.heading')}
          </Text>
          <Text tone="ink2">{t('customerSignIn.body')}</Text>
        </View>
        <Section footer={error ?? (sent ? t('customerSignIn.sentTo', { email }) : t('customerSignIn.noPassword'))}>
          <FieldRow label={t('signIn.email')} value={email} onChangeText={setEmail} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" editable={!sent} />
          {sent ? (
            <FieldRow
              label={t('customerSignIn.code')}
              value={code}
              onChangeText={(s) => setCode(s.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
            />
          ) : null}
        </Section>
        {devCode ? (
          <View style={{ marginHorizontal: 32, marginTop: 8 }}>
            <WhyNot icon="info" text={t('customerSignIn.devCode', { code: devCode })} />
          </View>
        ) : null}
        <View style={{ marginHorizontal: 16, marginTop: 16 }}>
          {sent ? (
            <Button title={t('customerSignIn.verify')} onPress={() => void verify()} busy={busy} disabled={code.length !== 6} />
          ) : (
            <Button title={t('customerSignIn.send')} onPress={() => void request()} busy={busy} disabled={!email.includes('@')} />
          )}
        </View>
      </Screen>
    </>
  );
}
