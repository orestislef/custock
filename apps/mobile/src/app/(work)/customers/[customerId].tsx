import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '@/lib/api';
import { date, dateTime } from '@/lib/format';
import { useOrg, useSession } from '@/lib/session';
import { Avatar, Pill, WhyNot } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { FieldRow } from '@/ui/Field';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { usePalette } from '@/ui/theme';

export default function CustomerDetail() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const { can } = useSession();
  const qc = useQueryClient();
  const res = useQuery({ queryKey: ['customer', org.orgId, customerId], queryFn: () => api.customer(org.orgId, customerId) });
  const [note, setNote] = useState('');
  const c = res.data;
  const lang = i18n.language;
  const scopeName = (type: string, id: string) => (type === 'org' ? org.name : type === 'group' ? t('common:scope.group') : org.shops.find((s) => s.shopId === id)?.name ?? t('common:scope.shop'));

  if (!c) return <Screen />;

  return (
    <>
      <Stack.Screen options={{ title: '', headerLargeTitleEnabled: false }} />
      <Screen>
        <View style={{ alignItems: 'center', gap: 6, paddingTop: 20 }}>
          <Avatar name={c.name} size={72} />
          <Text variant="title2" display>
            {c.name}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Pill text={c.locale.toUpperCase()} tone="info" />
            {c.tags.map((tg) => (
              <Pill key={tg} text={tg} />
            ))}
          </View>
        </View>

        <Section header={t('customer.contact')} footer={c.contactMasked ? undefined : t('customer.contactFooter')}>
          <Row icon="mail" iconTint={p.info} title={c.email ?? t('customer.none')} />
          {c.phone ? <Row icon="phone" iconTint={p.success} title={c.phone} /> : null}
        </Section>
        {c.contactMasked ? (
          <View style={{ marginHorizontal: 32, marginTop: 6 }}>
            <WhyNot icon="hidden" text={t('customer.maskedWhy')} />
          </View>
        ) : null}

        <Section header={t('customer.follows')}>
          {c.subscriptions.map((s) => (
            <Row key={`${s.scopeType}${s.scopeId}`} icon="shop" title={scopeName(s.scopeType, s.scopeId)} value={t(`customer.sub.${s.status}`)} />
          ))}
        </Section>

        <Section header={t('customer.consents')} footer={t('customer.consentsFooter')}>
          {c.consents.map((x, i) => (
            <Row
              key={i}
              icon={x.channel === 'email' ? 'mail' : 'bell'}
              iconTint={x.granted ? p.success : p.ink3}
              title={`${t(`common:channel.${x.channel}`)}: ${x.granted ? t('customer.granted') : t('customer.withdrawn')}`}
              subtitle={t('customer.consentLine', { when: date(x.createdAt, lang), source: t(`customer.source.${x.source}`, { defaultValue: x.source }), version: x.textVersion })}
            />
          ))}
        </Section>

        {c.waitingFor.length ? (
          <Section header={t('customer.waitingFor')}>
            {c.waitingFor.map((w) => (
              <Row key={w.variantId} icon="bell" title={w.productName} value={w.shopId ? scopeName('shop', w.shopId) : t('common:scope.allShops')} />
            ))}
          </Section>
        ) : null}

        {c.favorites.length ? (
          <Section header={t('customer.saved')}>
            {c.favorites.map((f) => (
              <Row key={f.productId} icon="heart" title={f.productName} />
            ))}
          </Section>
        ) : null}

        <Section header={t('customer.notes')}>
          {c.notes.map((n) => (
            <Row key={n.id} title={n.body} subtitle={`${n.authorName ?? ''} · ${dateTime(n.createdAt, lang)}`} />
          ))}
          {can('customers.edit', null) ? <FieldRow value={note} onChangeText={setNote} placeholder={t('customer.addNote')} multiline /> : null}
        </Section>
        {can('customers.edit', null) && note.trim() ? (
          <Button
            title={t('customer.saveNote')}
            kind="tinted"
            style={{ marginHorizontal: 16, marginTop: 10 }}
            onPress={() => {
              void api.addCustomerNote(org.orgId, c.id, note.trim()).then(() => {
                setNote('');
                void qc.invalidateQueries({ queryKey: ['customer', org.orgId, customerId] });
              });
            }}
          />
        ) : null}

        <Section header={t('customer.sent')}>
          {c.deliveries.slice(0, 6).map((d, i) => (
            <Row key={i} icon={d.channel === 'email' ? 'mail' : 'bell'} iconTint={p.ink2} title={t(`customer.delivery.${d.status}`, { defaultValue: d.status })} subtitle={dateTime(d.createdAt, lang)} />
          ))}
        </Section>
      </Screen>
    </>
  );
}
