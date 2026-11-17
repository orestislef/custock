// adjust stock: plus or minus with a reason. a sheet, one short task.

import { uuidv7, type AdjustReason } from '@custock/core';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { api, errorCode } from '@/lib/api';
import { useOrg } from '@/lib/session';
import { Chip, Segmented } from '@/ui/Bits';
import { Button, IconButton } from '@/ui/Button';
import { Tally } from '@/ui/Tally';
import { Text } from '@/ui/Text';
import { usePalette } from '@/ui/theme';
import { useSnackbar } from '@/ui/Snackbar';

const REASONS: AdjustReason[] = ['found', 'lost', 'damaged', 'expired', 'theft', 'own_use', 'correction'];

export default function AdjustSheet() {
  const { variantId, shopId, productId } = useLocalSearchParams<{ variantId: string; shopId: string; productId?: string }>();
  const { t } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const qc = useQueryClient();
  const snack = useSnackbar();
  const [dir, setDir] = useState<'minus' | 'plus'>('minus');
  const [n, setN] = useState(1);
  const [reason, setReason] = useState<AdjustReason | null>(null);
  const [busy, setBusy] = useState(false);

  const minusReasons: AdjustReason[] = ['lost', 'damaged', 'expired', 'theft', 'own_use', 'correction'];
  const plusReasons: AdjustReason[] = ['found', 'correction'];
  const reasons = REASONS.filter((r) => (dir === 'minus' ? minusReasons : plusReasons).includes(r));

  async function save() {
    if (!reason) return;
    setBusy(true);
    try {
      const kind = dir === 'minus' && ['damaged', 'expired', 'theft'].includes(reason) ? 'damage' : 'adjust';
      const res = await api.postMovements(org.orgId, [{ id: uuidv7(), shopId, variantId, qtyDelta: dir === 'minus' ? -n : n, kind, reason, occurredAt: Date.now() }]);
      if (res.rejected.length) throw { code: res.rejected[0]!.code };
      void qc.invalidateQueries({ queryKey: ['product', org.orgId, productId] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      snack({ text: t('adjust.saved'), icon: 'checkCircle' });
      router.back();
    } catch (e) {
      snack({ text: t(`common:error.${errorCode(e)}`), icon: 'warning' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: p.elevated }} contentContainerStyle={styles.body}>
      <Text variant="title3" weight="700">
        {t('adjust.title')}
      </Text>
      <Segmented
        value={dir}
        onChange={(d) => {
          setDir(d);
          setReason(null);
        }}
        options={[{ value: 'minus', label: t('adjust.remove') }, { value: 'plus', label: t('adjust.add') }]}
      />
      <View style={styles.stepper}>
        <IconButton icon="minus" label={t('adjust.less')} onPress={() => setN((x) => Math.max(1, x - 1))} size={52} />
        <Tally value={n} variant="largeTitle" accessibilityLabel={String(n)} />
        <IconButton icon="plus" label={t('adjust.more')} onPress={() => setN((x) => x + 1)} size={52} />
      </View>
      <Text variant="footnote" tone="ink2">
        {t('adjust.reasonRequired')}
      </Text>
      <View style={styles.reasons}>
        {reasons.map((r) => (
          <Chip key={r} label={t(`common:reason.${r}`)} selected={reason === r} onPress={() => setReason(r)} />
        ))}
      </View>
      <Button title={dir === 'minus' ? t('adjust.saveMinus', { count: n }) : t('adjust.savePlus', { count: n })} onPress={() => void save()} busy={busy} disabled={!reason} />
      <Button title={t('common:action.cancel')} kind="plain" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 16 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28, paddingVertical: 6 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
