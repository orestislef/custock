'use client';

// Automatic, Light or Dark for this device, next to the language in every account screen

import { Picker } from '@/components/ui/client-kit';
import { IconHalf } from '@/components/ui/icons';
import { setAppearance, useAppearance, type Appearance } from '@/lib/appearance';
import { useT } from '@/lib/i18n-client';

export function AppearanceSwitch() {
  const t = useT();
  const value = useAppearance();
  return (
    <Picker<Appearance>
      variant="quiet"
      className="min-h-[44px]"
      label={t('appearance.label')}
      icon={<IconHalf size={18} />}
      value={value}
      onChange={setAppearance}
      options={[
        { value: 'auto', label: t('appearance.auto') },
        { value: 'light', label: t('appearance.light') },
        { value: 'dark', label: t('appearance.dark') },
      ]}
    />
  );
}

// the row used in the account sheets
export function AppearanceRow({ as: Tag = 'li' }: { as?: 'li' | 'div' }) {
  const t = useT();
  return (
    <Tag className="row">
      <span className="row-main row-title">{t('appearance.label')}</span>
      <AppearanceSwitch />
    </Tag>
  );
}
