'use client';

// a staff screen that broke: the frame stays, the screen offers to try again
import { ErrorScreen } from '@/components/error-screen';

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen error={error} reset={reset} home="/admin" />;
}
