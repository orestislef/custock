// a new product from an unknown scanned code. name and price, the rest can wait.

import { parseMoney } from '@custock/core';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import { api, errorCode } from '@/lib/api';
import { useOrg } from '@/lib/session';
import { Button } from '@/ui/Button';
import { FieldRow } from '@/ui/Field';
import { Row, Section } from '@/ui/List';
import { useSnackbar } from '@/ui/Snackbar';
import { Text } from '@/ui/Text';
import { usePalette } from '@/ui/theme';

export default function NewProduct() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { t } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const qc = useQueryClient();
  const snack = useSnackbar();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const prod = await api.createProduct(org.orgId, { name: name.trim(), priceMinor: parseMoney(price), barcode: code, uom: 'piece', taxRateBp: 2400, trackStock: true });
      void qc.invalidateQueries({ queryKey: ['products'] });
      snack({ text: t('newProduct.saved'), icon: 'checkCircle' });
      router.back();
      router.push(`/(work)/stock/${prod.id}`);
    } catch (e) {
      snack({ text: t(`common:error.${errorCode(e)}`), icon: 'warning' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: p.elevated }} contentContainerStyle={{ paddingVertical: 20, gap: 4 }} keyboardShouldPersistTaps="handled">
      <Text variant="title3" weight="700" style={{ marginHorizontal: 20 }}>
        {t('newProduct.title')}
      </Text>
      <Section footer={t('newProduct.footer')}>
        {code ? <Row icon="barcode" iconTint={p.ink2} title={code} /> : null}
        <FieldRow label={t('newProduct.name')} value={name} onChangeText={setName} placeholder={t('newProduct.namePlaceholder')} autoFocus />
        <FieldRow label={t('newProduct.price')} value={price} onChangeText={setPrice} placeholder="0,00" keyboardType="decimal-pad" />
      </Section>
      <Button title={t('common:action.save')} onPress={() => void save()} busy={busy} disabled={!name.trim()} style={{ marginHorizontal: 16, marginTop: 12 }} />
      <Button title={t('common:action.cancel')} kind="plain" onPress={() => router.back()} style={{ marginHorizontal: 16 }} />
    </ScrollView>
  );
}
