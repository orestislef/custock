import { Redirect } from 'expo-router';

import { useSession } from '@/lib/session';

export default function Index() {
  const { me, side, org } = useSession();
  if (!me) return <Redirect href="/sign-in" />;
  if (side === 'work' && org) return <Redirect href="/(work)/home" />;
  return <Redirect href="/(shopper)/feed" />;
}
