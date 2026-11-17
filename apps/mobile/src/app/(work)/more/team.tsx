import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { api } from '@/lib/api';
import { useOrg, useSession } from '@/lib/session';
import { Avatar, Pill } from '@/ui/Bits';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';

export default function Team() {
  const { t } = useTranslation(['mobile', 'common']);
  const org = useOrg();
  const { can } = useSession();
  const members = useQuery({ queryKey: ['members', org.orgId], queryFn: () => api.members(org.orgId) });
  const roles = useQuery({ queryKey: ['roles', org.orgId], queryFn: () => api.roles(org.orgId) });
  const roleLabel = (id: string, fallback: string) => {
    const r = roles.data?.find((x) => x.id === id);
    return r?.templateKey ? t(`common:role.${r.templateKey}`) : fallback;
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: t('more.team'),
          headerRight: can('members.invite', null)
            ? () => (
                <Pressable onPress={() => router.push('/sheet/invite')} accessibilityRole="button" hitSlop={10}>
                  <Text variant="headline" tone="accent">
                    {t('team.invite')}
                  </Text>
                </Pressable>
              )
            : undefined,
        }}
      />
      <Screen>
        <Section header={t('team.members')} footer={t('team.footer')}>
          {(members.data ?? []).map((m) => (
            <Row
              key={m.membershipId}
              title={m.name ?? m.email ?? ''}
              subtitle={m.assignments.map((a) => `${roleLabel(a.roleId, a.roleName)} · ${a.scopeName}`).join('\n')}
              leading={<Avatar name={m.name} />}
              trailing={!m.canManage && m.manageBlockedBy ? <Pill icon="lock" tone="info" text={t(`team.blocked.${m.manageBlockedBy}`, { defaultValue: t('common:why.youDoNotHave') })} /> : undefined}
            />
          ))}
        </Section>
        <Section header={t('team.roles')}>
          {(roles.data ?? []).map((r) => (
            <Row key={r.id} icon="role" iconTint="#7B4FA0" title={r.templateKey ? t(`common:role.${r.templateKey}`) : r.name} subtitle={t('team.roleLine', { count: r.permissions.length, rank: r.rank })} value={String(r.memberCount)} />
          ))}
        </Section>
        <View style={{ height: 24 }} />
      </Screen>
    </>
  );
}
