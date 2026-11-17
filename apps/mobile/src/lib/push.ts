// push: asked only after someone follows a shop, after an explanation screen, never on launch.
// taps on a push open the exact screen. in development nothing is sent from the server.

import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

export async function pushStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  if (Platform.OS === 'web') return 'denied';
  const s = await Notifications.getPermissionsAsync();
  return s.status as 'granted' | 'denied' | 'undetermined';
}

export async function askForPush(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const s = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  return s.status === 'granted';
}

// deep links carried in the data of each push: post, product, transfer
export function routeForPush(data: Record<string, unknown>): string | null {
  if (typeof data.postId === 'string') return `/post/${data.postId}`;
  if (typeof data.productId === 'string') return `/product/${data.productId}`;
  if (typeof data.transferId === 'string') return `/transfer/${data.transferId}`;
  return null;
}

let started = false;
export function startPushHandling() {
  if (started || Platform.OS === 'web') return;
  started = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  Notifications.addNotificationResponseReceivedListener((r) => {
    const to = routeForPush((r.notification.request.content.data ?? {}) as Record<string, unknown>);
    if (to) router.push(to as never);
  });
}
