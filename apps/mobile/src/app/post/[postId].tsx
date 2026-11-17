// deep link from a push: opens the post on whichever side the person is on
import { Redirect, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/lib/session';

export default function PostLink() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { me, side, org } = useSession();
  if (!me) return <Redirect href="/sign-in" />;
  if (side === 'work' && org) return <Redirect href={{ pathname: '/(work)/posts/[postId]', params: { postId } }} />;
  return <Redirect href={{ pathname: '/(shopper)/feed/[postId]', params: { postId } }} />;
}
