// join a shop: scan the QR on the window, or type the code under it.

import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { USING_FIXTURES } from '@/lib/api';
import { Chip } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { FieldRow } from '@/ui/Field';
import { Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';

// a join QR holds https://<domain>/j/<code>. take the code from it.
function codeFrom(data: string): string | null {
  const m = data.match(/\/j\/([A-Za-z0-9-]+)/);
  if (m) return m[1]!;
  return /^[A-Za-z0-9-]{4,}$/.test(data.trim()) ? data.trim() : null;
}

export default function JoinScan() {
  const { t } = useTranslation(['mobile', 'common']);
  const [permission, requestPermission] = useCameraPermissions();
  const [code, setCode] = useState('');
  const done = useRef(false);
  const open = (c: string) => {
    if (done.current) return;
    done.current = true;
    router.replace({ pathname: '/(shopper)/shops/join/[code]', params: { code: c } });
  };
  const camera = Platform.OS !== 'web' && permission?.granted;
  return (
    <>
      <Stack.Screen options={{ title: t('shops.join'), headerLargeTitleEnabled: false }} />
      <Screen>
        <View style={styles.camera}>
          {camera ? (
            <CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(r) => { const c = codeFrom(r.data); if (c) open(c); }} />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
              <Text variant="subheadline" style={{ color: '#fff', textAlign: 'center' }}>
                {Platform.OS === 'web' ? t('join.webNoCamera') : t('join.cameraWhy')}
              </Text>
              {Platform.OS !== 'web' && !permission?.granted ? <Button title={t('scan.allowCamera')} onPress={() => void requestPermission()} /> : null}
            </View>
          )}
          <View style={styles.frame} pointerEvents="none" />
        </View>
        <Section footer={t('join.codeFooter')}>
          <FieldRow label={t('join.code')} value={code} onChangeText={setCode} placeholder="KIF-WIN" autoCapitalize="characters" onSubmitEditing={() => code && open(code)} />
        </Section>
        <View style={{ marginHorizontal: 16, marginTop: 12, gap: 10 }}>
          <Button title={t('common:action.next')} onPress={() => open(code)} disabled={code.trim().length < 4} />
          {USING_FIXTURES ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {['KIF-WIN', 'MAR-RCP', 'LEM-IG'].map((c) => (
                <Chip key={c} icon="qr" label={c} onPress={() => open(c)} />
              ))}
            </View>
          ) : null}
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  camera: { height: 280, marginHorizontal: 16, marginTop: 12, borderRadius: 20, overflow: 'hidden', backgroundColor: '#111114' },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  frame: { position: 'absolute', top: '20%', left: '25%', width: '50%', aspectRatio: 1, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', borderRadius: 18 },
});
