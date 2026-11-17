// scanning. the camera is the main input for stock work.
// camera: expo-camera's barcode scanner. it works in expo go and in local dev builds, needs no extra
// native setup, and covers every code we read (ean, upc, itf-14, code 128, qr, datamatrix).
// react-native-vision-camera would be faster for very long sessions, revisit if shops ask.
// modes are filtered by permission. receive and count keep a running list, sell takes one off
// with undo, look up opens the product.

import { ean13, uuidv7, type MovementBatchResult, type Product, type ScanResult, type StockLevel } from '@custock/core';
import { useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, errorCode, USING_FIXTURES } from '@/lib/api';
import { qty } from '@/lib/format';
import { useOrg, useSession } from '@/lib/session';
import { BackInStockMoment } from '@/ui/BackInStock';
import { Chip, EmptyState, Segmented, WhyNot } from '@/ui/Bits';
import { Button, IconButton } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { useSnackbar } from '@/ui/Snackbar';
import { Tally } from '@/ui/Tally';
import { Text } from '@/ui/Text';
import { radius, textStyle, usePalette } from '@/ui/theme';

type Mode = 'lookup' | 'receive' | 'sell' | 'count';

const MODE_PERM: Record<Mode, string> = { lookup: 'products.view', receive: 'stock.receive', sell: 'stock.sell', count: 'stock.count' };
const CODES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14', 'code128', 'code39', 'qr', 'datamatrix'];

interface Line { variantId: string; product: Product; qty: number; expected: number }

function tick() {
  if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function ScanLine() {
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (!reduce) y.value = withRepeat(withTiming(1, { duration: 1600 }), -1, true);
  }, [reduce, y]);
  const style = useAnimatedStyle(() => ({ top: `${12 + y.value * 76}%` }));
  return <Animated.View style={[styles.scanLine, style]} />;
}

export default function Scan() {
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const org = useOrg();
  const { can, shopId } = useSession();
  const qc = useQueryClient();
  const snack = useSnackbar();
  const params = useLocalSearchParams<{ mode?: Mode; variantId?: string }>();
  const [permission, requestPermission] = useCameraPermissions();

  // the shop we scan in: the selected one, else the first where the member can scan
  const workShop = shopId ?? org.shops.find((s) => s.perms.some((x) => x.startsWith('stock.')))?.shopId ?? null;
  const modes = (['lookup', 'sell', 'receive', 'count'] as Mode[]).filter((m) => can(MODE_PERM[m], m === 'lookup' ? undefined : workShop));
  const [mode, setMode] = useState<Mode>(params.mode && modes.includes(params.mode) ? params.mode : modes.includes('sell') ? 'sell' : modes[0] ?? 'lookup');
  // a new mode from a link (home buttons) wins over the last one used
  const [linkedMode, setLinkedMode] = useState(params.mode);
  if (params.mode !== linkedMode) {
    setLinkedMode(params.mode);
    if (params.mode && modes.includes(params.mode)) setMode(params.mode);
  }

  const [lines, setLines] = useState<Line[]>([]);
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState<ScanResult | null>(null);
  const [moment, setMoment] = useState<{ count: number; name: string } | null>(null);
  const countId = useRef<string | null>(null);
  const [active, setActive] = useState(true);
  const last = useRef<{ code: string; at: number } | null>(null);
  const reduce = useReducedMotion();

  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => setActive(false);
    }, []),
  );

  // receiving straight from a product page
  useEffect(() => {
    if (!params.variantId) return;
    void (async () => {
      const list = await api.products(org.orgId, {});
      const prod = list.items.find((x) => x.variants.some((v) => v.id === params.variantId));
      if (prod) addLine(prod, params.variantId!, 1, prod.levels);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.variantId]);

  function addLine(product: Product, variantId: string, n: number, levels?: StockLevel[]) {
    const expected = levels?.find((l) => l.variantId === variantId && l.shopId === workShop)?.onHand ?? 0;
    setLines((cur) => {
      const i = cur.findIndex((l) => l.variantId === variantId);
      if (i >= 0) {
        const next = [...cur];
        next[i] = { ...next[i]!, qty: next[i]!.qty + n };
        return [next[i]!, ...next.filter((_, j) => j !== i)];
      }
      return [{ variantId, product, qty: n, expected }, ...cur];
    });
  }

  const afterMovements = useCallback((res: MovementBatchResult, names: Map<string, string>) => {
    void qc.invalidateQueries({ queryKey: ['products'] });
    void qc.invalidateQueries({ queryKey: ['product'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    const told = res.backInStock.reduce((n, b) => n + b.notified, 0);
    if (told > 0) setMoment({ count: told, name: names.get(res.backInStock[0]!.variantId) ?? '' });
    if (res.lowStock.length) snack({ text: t('scan.lowStockNote', { count: res.lowStock.length }), icon: 'few' });
  }, [qc, snack, t]);

  async function sellOne(product: Product, variantId: string, n: number) {
    if (!workShop) return;
    const id = uuidv7();
    const res = await api.postMovements(org.orgId, [{ id, shopId: workShop, variantId, qtyDelta: -n, kind: 'sale', occurredAt: Date.now() }]);
    if (res.rejected.length) {
      snack({ text: t(`common:error.${res.rejected[0]!.code}`), icon: 'warning' });
      return;
    }
    afterMovements(res, new Map([[variantId, product.name]]));
    addLine(product, variantId, n);
    snack({
      text: t('scan.sold', { name: product.name, count: n }),
      icon: 'checkCircle',
      actionLabel: t('common:action.undo'),
      onAction: () => {
        void api
          .postMovements(org.orgId, [{ id: uuidv7(), shopId: workShop, variantId, qtyDelta: n, kind: 'reversal', refType: 'reversal', refId: id, occurredAt: Date.now() }])
          .then(() => {
            setLines((cur) => cur.map((l) => (l.variantId === variantId ? { ...l, qty: l.qty - n } : l)).filter((l) => l.qty > 0));
            void qc.invalidateQueries({ queryKey: ['products'] });
          });
      },
    });
  }

  async function handleCode(raw: string, symbology?: string) {
    const now = Date.now();
    if (last.current && last.current.code === raw && now - last.current.at < 1500) return; // holding still is not 20 scans
    last.current = { code: raw, at: now };
    tick();
    try {
      const r = await api.scan(org.orgId, raw, symbology, workShop ?? undefined);
      if (r.match === 'unknown' || !r.product || !r.variantId) {
        setUnknown(r);
        return;
      }
      setUnknown(null);
      if (mode === 'lookup') {
        router.push(`/(work)/stock/${r.product.id}`);
      } else if (mode === 'sell') {
        await sellOne(r.product, r.variantId, r.packQty);
      } else if (mode === 'count') {
        await countScan(r.product, r.variantId, r.packQty, 'add');
      } else {
        addLine(r.product, r.variantId, r.packQty, (r.product as Product & { levels?: StockLevel[] }).levels);
      }
    } catch (e) {
      snack({ text: t(`common:error.${errorCode(e)}`), icon: 'warning' });
    }
  }

  // counts live on the server: several phones can count the same shop at once
  async function countScan(product: Product, variantId: string, n: number, how: 'add' | 'set') {
    if (!workShop) return;
    if (!countId.current) countId.current = (await api.startCount(org.orgId, workShop, { kind: 'partial' })).id;
    const line = await api.setCountLine(org.orgId, countId.current, variantId, n, how);
    setLines((cur) => [{ variantId, product, qty: line.countedQty, expected: line.expectedQty }, ...cur.filter((l) => l.variantId !== variantId)]);
  }

  async function finishCount() {
    if (!countId.current) return;
    setBusy(true);
    try {
      await api.submitCount(org.orgId, countId.current);
      if (can('stock.count.approve', workShop)) {
        const applied = await api.applyCount(org.orgId, countId.current, 'ignore');
        const diffs = applied.lines.filter((l) => l.difference !== 0).length;
        snack({ text: diffs ? t('scan.countApplied', { count: diffs }) : t('scan.countNoDifferences'), icon: 'checkCircle' });
        void qc.invalidateQueries({ queryKey: ['products'] });
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
      } else {
        snack({ text: t('scan.countSubmitted'), icon: 'checkCircle' });
      }
      countId.current = null;
      setLines([]);
    } catch (e) {
      snack({ text: t(`common:error.${errorCode(e)}`), icon: 'warning' });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!workShop || !lines.length) return;
    setBusy(true);
    try {
      const batchId = uuidv7();
      const names = new Map(lines.map((l) => [l.variantId, l.product.name]));
      const movements = lines.filter((l) => l.qty > 0).map((l) => ({ id: uuidv7(), shopId: workShop, variantId: l.variantId, qtyDelta: l.qty, kind: 'receive' as const, batchId, occurredAt: Date.now() }));
      if (!movements.length) return;
      const res = await api.postMovements(org.orgId, movements);
      afterMovements(res, names);
      const total = lines.reduce((n, l) => n + l.qty, 0);
      snack({ text: t('scan.received', { count: total }), icon: 'checkCircle' });
      setLines([]);
    } catch (e) {
      snack({ text: t(`common:error.${errorCode(e)}`), icon: 'warning' });
    } finally {
      setBusy(false);
    }
  }

  // demo data only: the honey (people are waiting for it), olive oil, loukoumi and a code nobody knows
  const sampleCodes = useMemo(() => (USING_FIXTURES ? [ean13('520123000010'), ean13('520123000000'), ean13('520123000090'), '4006381333931'] : []), []);
  const total = lines.reduce((n, l) => n + l.qty, 0);
  const cameraOk = Platform.OS !== 'web' && permission?.granted;
  const canCreate = can('products.create');

  if (!modes.length) {
    return (
      <View style={{ flex: 1, backgroundColor: p.shelf, justifyContent: 'center' }}>
        <EmptyState icon="lock" title={t('scan.noModesTitle')} body={t('scan.noModesBody')} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <View style={[styles.camera, { paddingTop: insets.top }]}>
          {cameraOk && active ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: CODES }}
              onBarcodeScanned={(r) => void handleCode(r.data, r.type)}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.noCamera]}>
              <Icon name="scan" size={44} color="rgba(255,255,255,0.6)" />
              <Text variant="subheadline" style={{ color: 'rgba(255,255,255,0.8)', textAlign: 'center', maxWidth: 280 }}>
                {Platform.OS === 'web' ? t('scan.webNoCamera') : t('scan.cameraWhy')}
              </Text>
              {Platform.OS !== 'web' && !permission?.granted ? <Button title={t('scan.allowCamera')} onPress={() => void requestPermission()} style={{ marginTop: 8 }} /> : null}
            </View>
          )}
          {cameraOk ? (
            <View style={styles.frame} pointerEvents="none">
              <View style={styles.frameBox}>
                <ScanLine />
              </View>
            </View>
          ) : null}
          <View style={[styles.topBar, { top: insets.top + 8 }]}>
            <View style={styles.modeBadge}>
              <Text variant="footnote" weight="600" style={{ color: '#fff' }}>
                {org.shops.find((s) => s.shopId === workShop)?.name ?? org.name}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {Platform.OS !== 'web' ? <IconButton icon="torch" label={t('scan.torch')} onPress={() => setTorch((x) => !x)} tint={torch ? '#FFD60A' : '#fff'} /> : null}
              <IconButton icon="keyboard" label={t('scan.typeCode')} onPress={() => setManual((x) => !x)} tint="#fff" />
            </View>
          </View>
        </View>

        <View style={[styles.panel, { backgroundColor: p.shelf, paddingBottom: insets.bottom + 72 }]}>
          <Segmented value={mode} onChange={(m) => { setMode(m); setLines([]); setUnknown(null); countId.current = null; }} options={modes.map((m) => ({ value: m, label: t(`scan.mode.${m}`) }))} />

          {manual ? (
            <View style={[styles.manual, { backgroundColor: p.surface }]}>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder={t('scan.typeCodePlaceholder')}
                placeholderTextColor={p.ink3}
                keyboardType="number-pad"
                autoFocus
                onSubmitEditing={() => { void handleCode(code.trim()); setCode(''); }}
                style={[textStyle('body'), { flex: 1, color: p.ink, minHeight: 44 }]}
                accessibilityLabel={t('scan.typeCode')}
              />
              <Button title={t('common:action.add')} kind="tinted" onPress={() => { void handleCode(code.trim()); setCode(''); }} disabled={!code.trim()} />
            </View>
          ) : null}

          {sampleCodes.length && !cameraOk ? (
            <View style={{ gap: 6 }}>
              <Text variant="footnote" tone="ink2">
                {t('scan.samples')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {sampleCodes.map((c) => (
                  <Chip key={c} icon="barcode" label={c} onPress={() => { last.current = null; void handleCode(c, 'ean13'); }} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {unknown ? (
            <Animated.View entering={reduce ? undefined : FadeInDown.duration(200)} style={[styles.unknown, { backgroundColor: p.surface }]}>
              <Text variant="headline">{t('scan.unknownTitle')}</Text>
              <Text variant="subheadline" tone="ink2">
                {unknown.valid ? unknown.codeNorm : t('scan.damaged')}
              </Text>
              {canCreate ? (
                <Button title={t('scan.createWithCode')} kind="tinted" icon="plus" onPress={() => router.push({ pathname: '/sheet/new-product', params: { code: unknown.codeNorm } })} />
              ) : (
                <WhyNot icon="info" text={t('scan.unknownSaved')} />
              )}
            </Animated.View>
          ) : null}

          {mode !== 'lookup' && lines.length ? (
            <View style={{ gap: 8, flexShrink: 1 }}>
              <View style={styles.listHead}>
                <Text variant="footnote" tone="ink2">
                  {mode === 'sell' ? t('scan.listHead.sell', { count: total }) : `${t('scan.lines', { count: lines.length })} · ${t(`scan.listHead.${mode}`, { count: total })}`}
                </Text>
                {mode !== 'sell' ? (
                  <Pressable onPress={() => setLines([])} accessibilityRole="button" hitSlop={8}>
                    <Text variant="footnote" tone="accent" weight="600">
                      {t('scan.clear')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ gap: 1 }}>
                {lines.map((l) => (
                  <Animated.View key={l.variantId} layout={reduce ? undefined : LinearTransition.duration(200)} entering={reduce ? undefined : FadeInDown.duration(180)} style={[styles.line, { backgroundColor: p.surface }]}>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1}>{l.product.name}</Text>
                      {mode === 'count' ? (
                        <Text variant="footnote" tone={l.qty === l.expected ? 'ink2' : 'accent'}>
                          {t('scan.expected', { qty: qty(l.expected, l.product.uom, i18n.language) })}
                        </Text>
                      ) : null}
                    </View>
                    {mode !== 'sell' ? <IconButton icon="minus" label={t('adjust.less')} size={36} onPress={() => (mode === 'count' ? void countScan(l.product, l.variantId, Math.max(0, l.qty - 1), 'set') : setLines((cur) => cur.map((x) => (x.variantId === l.variantId ? { ...x, qty: Math.max(0, x.qty - 1) } : x))))} /> : null}
                    <View style={{ minWidth: 40, alignItems: 'center' }}>
                      <Tally value={l.qty} variant="headline" />
                    </View>
                    {mode !== 'sell' ? <IconButton icon="plus" label={t('adjust.more')} size={36} onPress={() => (mode === 'count' ? void countScan(l.product, l.variantId, l.qty + 1, 'set') : setLines((cur) => cur.map((x) => (x.variantId === l.variantId ? { ...x, qty: x.qty + 1 } : x))))} /> : null}
                  </Animated.View>
                ))}
              </ScrollView>
              {mode === 'receive' ? <Button title={t('scan.receiveCta', { count: total })} onPress={() => void confirm()} busy={busy} icon="receive" /> : null}
              {mode === 'count' ? (
                can('stock.count.approve', workShop) ? (
                  <Button title={t('scan.applyCount')} onPress={() => void finishCount()} busy={busy} icon="check" />
                ) : (
                  <View style={{ gap: 8 }}>
                    <Button title={t('scan.submitCount')} onPress={() => void finishCount()} busy={busy} icon="send" />
                    <WhyNot icon="info" text={t('scan.countNeedsApproval')} />
                  </View>
                )
              ) : null}
            </View>
          ) : (
            <Text variant="subheadline" tone="ink2" align="center" style={{ marginTop: 8 }}>
              {t(`scan.hint.${mode}`)}
            </Text>
          )}
        </View>

        {moment ? <BackInStockMoment count={moment.count} productName={moment.name} onDone={() => { setMoment(null); snack({ text: t('scan.toldSnack', { count: moment.count }), icon: 'bell' }); }} /> : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  camera: { flex: 1, minHeight: 260 },
  noCamera: { alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#111114', padding: 24 },
  frame: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  frameBox: { width: '72%', aspectRatio: 1.6, borderRadius: 18, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', overflow: 'hidden' },
  scanLine: { position: 'absolute', left: 10, right: 10, height: 2, borderRadius: 1, backgroundColor: '#FF6B8E' },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modeBadge: { paddingHorizontal: 12, minHeight: 32, justifyContent: 'center', borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: { borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -24, padding: 16, gap: 12 },
  manual: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 4, borderRadius: radius.m },
  unknown: { borderRadius: radius.m, padding: 14, gap: 8 },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 52, borderRadius: 10 },
});
