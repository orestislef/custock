'use client';

// mounted once in the root layout: uncaught errors and unhandled rejections go to the super
// admin's Errors screen (lib/report-error.ts)

import { useEffect } from 'react';
import { installErrorReporting } from '@/lib/report-error';

export function ReportErrors() {
  useEffect(() => installErrorReporting(), []);
  return null;
}
