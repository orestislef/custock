// deep link from a push (back in stock, low stock): the product on the right side
import { Redirect, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/lib/session';

export default function ProductLink() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const { me, side, org } = useSession();
  if (!me) return <Redirect href="/sign-in" />;
  if (side === 'work' && org) return <Redirect href={{ pathname: '/(work)/stock/[productId]', params: { productId } }} />;
  const orgId = me.following[0]?.orgId ?? '';
  return <Redirect href={{ pathname: '/(shopper)/catalog/[productId]', params: { productId, org: orgId } }} />;
}
