// invite someone. roles you cannot give are visible but locked, with the reason.

import type { ScopeType } from '@custock/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { api, errorCode } from '@/lib/api';
import { currentLocale } from '@/lib/i18n';
import { useOrg } from '@/lib/session';
import { Chip, WhyNot } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { FieldRow } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Row, Section } from '@/ui/List';
import { useSnackbar } from '@/ui/Snackbar';
import { Text } from '@/ui/Text';
import { usePalette } from '@/ui/theme';

export default function Invite() {
  const { t } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const snack = useSnackbar();
  const inviteShops = org.shops.filter((s) => s.perms.includes('members.invite'));
  const orgWide = org.shops.length > 1 && inviteShops.length === org.shops.length;
  const [scope, setScope] = useState<{ scopeType: ScopeType; scopeId: string }>(orgWide ? { scopeType: 'org', scopeId: org.orgId } : { scopeType: 'shop', scopeId: inviteShops[0]?.shopId ?? '' });
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roles = useQuery({ queryKey: ['grantable', org.orgId, scope], queryFn: () => api.grantableRoles(org.orgId, scope.scopeType, scope.scopeId) });

  async function send() {
    if (!roleId) return;
    setBusy(true);
    try {
      await api.invite(org.orgId, { email, roleId, ...scope, locale: currentLocale() });
      snack({ text: t('invite.sent', { email }), icon: 'checkCircle' });
      router.back();
    } catch (e) {
      snack({ text: t(`common:error.${errorCode(e)}`), icon: 'warning' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: p.elevated }} contentContainerStyle={{ paddingVertical: 20 }} keyboardShouldPersistTaps="handled">
      <Text variant="title3" weight="700" style={{ marginHorizontal: 20 }}>
        {t('invite.title')}
      </Text>
      <Section footer={t('invite.emailFooter')}>
        <FieldRow label={t('signIn.email')} value={email} onChangeText={setEmail} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" />
      </Section>
      <Section header={t('invite.where')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 }}>
          {orgWide ? <Chip label={t('common:scope.org')} selected={scope.scopeType === 'org'} onPress={() => setScope({ scopeType: 'org', scopeId: org.orgId })} /> : null}
          {inviteShops.map((s) => (
            <Chip key={s.shopId} label={s.name} selected={scope.scopeId === s.shopId} onPress={() => setScope({ scopeType: 'shop', scopeId: s.shopId })} />
          ))}
        </View>
      </Section>
      <Section header={t('invite.role')} footer={t('invite.roleFooter')}>
        {(roles.data ?? []).map((r) => (
          <Row
            key={r.roleId}
            title={t(`common:role.${r.roleId.replace('role_', '')}`, { defaultValue: r.name })}
            subtitle={r.ok ? undefined : t(`invite.blocked.${r.blockedBy}`, { defaultValue: t('common:why.youDoNotHave') })}
            disabled={!r.ok}
            trailing={r.ok ? (roleId === r.roleId ? <Icon name="check" size={16} color={p.accent} weight="bold" /> : undefined) : <Icon name="lock" size={14} color={p.ink3} />}
            onPress={r.ok ? () => setRoleId(r.roleId) : undefined}
            chevron={false}
          />
        ))}
      </Section>
      <View style={{ marginHorizontal: 16, marginTop: 16, gap: 8 }}>
        <Button title={t('invite.send')} onPress={() => void send()} busy={busy} disabled={!roleId || !email.includes('@')} icon="send" />
        <WhyNot icon="info" text={t('invite.noEmailInDev')} />
      </View>
    </ScrollView>
  );
}
