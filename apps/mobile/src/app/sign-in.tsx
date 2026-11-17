// staff sign in. customers use the email code sign in. with demo data, the demo accounts are listed.

import type { AppLocale } from '@custock/i18n';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { api, errorCode, USING_FIXTURES } from '@/lib/api';
import { DEMO_ACCOUNTS, FIXTURE_OTP } from '@/lib/fixtures';
import { setLocale } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Avatar, Pill } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { FieldRow } from '@/ui/Field';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { usePalette } from '@/ui/theme';

export default function SignIn() {
  const { t } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const { signIn } = useSession();
  const params = useLocalSearchParams<{ as?: string; lang?: string; next?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pw = useRef<ComponentRef<typeof TextInput>>(null);

  async function go(e = email, pass = password) {
    setBusy(true);
    setError(null);
    try {
      await signIn(await api.login(e, pass));
      router.replace('/');
    } catch (err) {
      setError(t(`common:error.${errorCode(err)}`));
    } finally {
      setBusy(false);
    }
  }

  async function demo(acc: (typeof DEMO_ACCOUNTS)[number], next?: string) {
    setBusy(true);
    try {
      const tokens = acc.otp ? await api.verifyOtp(acc.email, FIXTURE_OTP) : await api.login(acc.email, 'custock');
      await signIn(tokens);
      router.replace((next || '/') as never);
    } finally {
      setBusy(false);
    }
  }

  // screenshots and quick testing: /sign-in?as=maria&lang=el&next=/stock
  useEffect(() => {
    if (!USING_FIXTURES || !params.as) return;
    const acc = DEMO_ACCOUNTS.find((a) => a.email.startsWith(`${params.as}@`));
    void (async () => {
      if (params.lang) await setLocale(params.lang as AppLocale);
      if (acc) await demo(acc, params.next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.as]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.shelf }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen contentContainerStyle={{ paddingBottom: 48, paddingTop: 56 }}>
        <View style={styles.hero}>
          <View style={[styles.mark, { backgroundColor: p.accentFill }]}>
            <View style={[styles.markInner, { borderColor: p.onAccent }]} />
          </View>
          <Text variant="largeTitle" display>
            Custock
          </Text>
          <Text tone="ink2" align="center">
            {t('common:app.tagline')}
          </Text>
        </View>

        <Section header={t('signIn.staffHeader')} footer={error ?? t('signIn.staffFooter')}>
          <FieldRow
            label={t('signIn.email')}
            value={email}
            onChangeText={setEmail}
            placeholder="name@shop.gr"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => pw.current?.focus()}
          />
          <FieldRow
            ref={pw}
            label={t('signIn.password')}
            value={password}
            onChangeText={setPassword}
            placeholder={t('signIn.passwordPlaceholder')}
            secureTextEntry
            textContentType="password"
            autoComplete="current-password"
            returnKeyType="go"
            onSubmitEditing={() => void go()}
          />
        </Section>
        <View style={styles.actions}>
          <Button title={t('common:action.signIn')} onPress={() => void go()} busy={busy} disabled={!email || !password} />
          <Button title={t('signIn.customerLink')} kind="plain" onPress={() => router.push('/customer-sign-in')} />
        </View>

        {USING_FIXTURES ? (
          <Section header={t('signIn.demoHeader')} footer={t('signIn.demoFooter')}>
            {DEMO_ACCOUNTS.map((a) => (
              <Row
                key={a.email}
                title={a.name}
                subtitle={a.scope && a.scope !== 'org' ? `${t(`common:role.${a.role}`)} · ${a.scope}` : t(`common:role.${a.role}`)}
                leading={<Avatar name={a.name} />}
                trailing={a.otp ? <Pill text={t('signIn.emailCode')} tone="info" /> : undefined}
                onPress={() => void demo(a)}
              />
            ))}
          </Section>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8, paddingHorizontal: 32, marginBottom: 8 },
  mark: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  markInner: { width: 30, height: 30, borderRadius: 15, borderWidth: 4, marginLeft: 12, opacity: 0.9 },
  actions: { marginHorizontal: 16, marginTop: 16, gap: 4 },
});
