'use client';

// a customer screen that broke: the business frame stays, the screen offers to try again
import { useParams } from 'next/navigation';
import { ErrorScreen } from '@/components/error-screen';

export default function ShopError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { org } = useParams<{ org: string }>();
  return <ErrorScreen error={error} reset={reset} home={`/s/${org}`} />;
}
