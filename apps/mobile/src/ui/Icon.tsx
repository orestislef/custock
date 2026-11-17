// one icon set: sf symbols on ios, material symbols on android and web (both through expo-symbols).

import { SymbolView } from 'expo-symbols';
import type { AndroidSymbol } from 'expo-symbols';
import type { ColorValue } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { usePalette } from './theme';

export const ICONS = {
  home: { ios: 'house.fill', md: 'home' },
  stock: { ios: 'shippingbox.fill', md: 'inventory_2' },
  scan: { ios: 'barcode.viewfinder', md: 'barcode_scanner' },
  customers: { ios: 'person.2.fill', md: 'group' },
  posts: { ios: 'megaphone.fill', md: 'campaign' },
  more: { ios: 'ellipsis.circle.fill', md: 'more_horiz' },
  search: { ios: 'magnifyingglass', md: 'search' },
  chevron: { ios: 'chevron.right', md: 'chevron_right' },
  shop: { ios: 'storefront.fill', md: 'storefront' },
  offer: { ios: 'tag.fill', md: 'local_offer' },
  heart: { ios: 'heart.fill', md: 'favorite' },
  heartOutline: { ios: 'heart', md: 'favorite_border' },
  person: { ios: 'person.crop.circle.fill', md: 'account_circle' },
  bell: { ios: 'bell.fill', md: 'notifications' },
  qr: { ios: 'qrcode.viewfinder', md: 'qr_code_scanner' },
  plus: { ios: 'plus', md: 'add' },
  minus: { ios: 'minus', md: 'remove' },
  close: { ios: 'xmark', md: 'close' },
  check: { ios: 'checkmark', md: 'check' },
  checkCircle: { ios: 'checkmark.circle.fill', md: 'check_circle' },
  lock: { ios: 'lock.fill', md: 'lock' },
  hidden: { ios: 'eye.slash', md: 'visibility_off' },
  warning: { ios: 'exclamationmark.triangle.fill', md: 'warning' },
  truck: { ios: 'shippingbox.and.arrow.backward.fill', md: 'local_shipping' },
  history: { ios: 'clock.arrow.circlepath', md: 'history' },
  chart: { ios: 'chart.bar.fill', md: 'bar_chart' },
  settings: { ios: 'gearshape.fill', md: 'settings' },
  torch: { ios: 'flashlight.on.fill', md: 'flashlight_on' },
  keyboard: { ios: 'keyboard', md: 'keyboard' },
  undo: { ios: 'arrow.uturn.backward', md: 'undo' },
  bag: { ios: 'bag.fill', md: 'shopping_bag' },
  sell: { ios: 'cart.fill.badge.minus', md: 'sell' },
  receive: { ios: 'tray.and.arrow.down.fill', md: 'move_to_inbox' },
  count: { ios: 'number.square.fill', md: 'tag' },
  mail: { ios: 'envelope.fill', md: 'mail' },
  language: { ios: 'globe', md: 'language' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', md: 'logout' },
  swap: { ios: 'arrow.left.arrow.right', md: 'swap_horiz' },
  trash: { ios: 'trash.fill', md: 'delete' },
  download: { ios: 'square.and.arrow.down', md: 'download' },
  clock: { ios: 'clock.fill', md: 'schedule' },
  send: { ios: 'paperplane.fill', md: 'send' },
  info: { ios: 'info.circle.fill', md: 'info' },
  out: { ios: 'circle.slash', md: 'do_not_disturb_on' },
  few: { ios: 'circle.lefthalf.filled', md: 'hourglass_empty' },
  phone: { ios: 'phone.fill', md: 'call' },
  map: { ios: 'map.fill', md: 'map' },
  edit: { ios: 'pencil', md: 'edit' },
  team: { ios: 'person.3.fill', md: 'groups' },
  invite: { ios: 'person.badge.plus', md: 'person_add' },
  filter: { ios: 'line.3.horizontal.decrease.circle', md: 'filter_list' },
  barcode: { ios: 'barcode', md: 'barcode' },
  photo: { ios: 'photo', md: 'photo' },
  error: { ios: 'xmark.octagon.fill', md: 'error' },
  role: { ios: 'person.badge.shield.checkmark.fill', md: 'shield_person' },
  tune: { ios: 'slider.horizontal.3', md: 'tune' },
} as const satisfies Record<string, { ios: SFSymbol; md: AndroidSymbol }>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, color, weight = 'regular' }: { name: IconName; size?: number; color?: ColorValue; weight?: 'regular' | 'medium' | 'semibold' | 'bold' }) {
  const p = usePalette();
  const i = ICONS[name];
  return (
    <SymbolView
      name={{ ios: i.ios, android: i.md, web: i.md }}
      size={size}
      tintColor={color ?? p.ink}
      weight={weight}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
