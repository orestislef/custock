import { LOCALE_NAMES, type AppLocale } from '@custock/i18n';
import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Share } from 'react-native';

import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Avatar } from '@/ui/Bits';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { Toggle } from '@/ui/Toggle';
import { useSnackbar } from '@/ui/Snackbar';
import { usePalette } from '@/ui/theme';

export default function Me() {
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const snack = useSnackbar();
  const { me, org, signOut, setSide } = useSession();
  const following = me?.following ?? [];
  const [channels, setChannels] = useState<Record<string, { email: boolean; push: boolean }>>({});
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api.alerts(), enabled: !!following.length });
  const favs = useQuery({ queryKey: ['favorites'], queryFn: () => api.favorites(), enabled: !!following.length });
  const waiting = (alerts.data ?? []).filter((a) => a.status === 'waiting');
  const saved = favs.data ?? [];

  const toggle = (orgId: string, ch: 'email' | 'push', on: boolean) => {
    setChannels((c) => ({ ...c, [orgId]: { email: c[orgId]?.email ?? true, push: c[orgId]?.push ?? true, [ch]: on } }));
    void api.setChannel(orgId, ch, on);
  };

  const deleteAccount = () => {
    const go = () => void api.deleteMyAccount().then(() => signOut()).then(() => router.replace('/sign-in'));
    if (Platform.OS === 'web') return go();
    Alert.alert(t('me.deleteTitle'), t('me.deleteBody'), [
      { text: t('common:action.cancel'), style: 'cancel' },
      { text: t('me.delete'), style: 'destructive', onPress: go },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: t('tabs.profile') }} />
      <Screen>
        <Section>
          <Row title={me?.user.displayName ?? ''} subtitle={me?.user.email ?? undefined} leading={<Avatar name={me?.user.displayName ?? null} size={44} />} />
        </Section>

        {following.map((f) => (
          <Section key={f.orgId} header={f.orgName} footer={t('me.channelsFooter')}>
            <Row icon="mail" iconTint={p.info} title={t('common:channel.email')} trailing={<Toggle value={channels[f.orgId]?.email ?? true} onValueChange={(v) => toggle(f.orgId, 'email', v)} />} />
            <Row icon="bell" title={t('common:channel.push')} trailing={<Toggle value={channels[f.orgId]?.push ?? true} onValueChange={(v) => toggle(f.orgId, 'push', v)} />} />
          </Section>
        ))}

        <Section header={t('me.waiting')}>
          {waiting.length ? waiting.map((x) => <Row key={x.id} icon="bell" title={x.productName} subtitle={x.shopName ?? x.orgName} onPress={() => router.push({ pathname: '/(shopper)/catalog/[productId]', params: { productId: x.productId, org: x.orgId } })} />) : <Row icon="bell" iconTint={p.ink3} title={t('me.waitingEmpty')} />}
        </Section>
        <Section header={t('me.saved')}>
          {saved.length ? saved.map((x) => <Row key={x.id} icon="heart" title={x.name} onPress={() => router.push({ pathname: '/(shopper)/catalog/[productId]', params: { productId: x.id, org: x.orgId } })} />) : <Row icon="heartOutline" iconTint={p.ink3} title={t('me.savedEmpty')} />}
        </Section>

        <Section header={t('more.you')}>
          <Row icon="language" iconTint={p.info} title={t('more.language')} value={LOCALE_NAMES[i18n.language as AppLocale]} onPress={() => router.push('/sheet/language')} />
          {org ? <Row icon="swap" iconTint={p.accent} title={t('me.switchToWork')} onPress={() => { setSide('work'); router.replace('/(work)/home'); }} /> : null}
        </Section>

        <Section header={t('me.privacy')} footer={t('me.privacyFooter')}>
          <Row icon="download" iconTint={p.info} title={t('me.export')} onPress={() => { void api.exportMyData().then((d) => { void Share.share({ message: JSON.stringify(d, null, 2) }); snack({ text: t('me.exported'), icon: 'checkCircle' }); }); }} />
          <Row icon="trash" iconTint={p.negText} title={t('me.delete')} destructive onPress={deleteAccount} chevron={false} />
        </Section>
        <Section>
          <Row icon="logout" iconTint={p.ink2} title={t('common:action.signOut')} destructive onPress={() => { void signOut().then(() => router.replace('/sign-in')); }} chevron={false} />
        </Section>
      </Screen>
    </>
  );
}
