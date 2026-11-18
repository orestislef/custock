import type { Metadata, Viewport } from 'next';
import { Commissioner } from 'next/font/google';
import { getLocale } from '@/lib/i18n-server';
import { I18nProvider } from '@/lib/i18n-client';
import { ToastProvider } from '@/components/ui/client-kit';
import { PwaRoot } from '@/components/pwa/pwa-root';
import { ReportErrors } from '@/components/report-errors';
import { appIcons } from '@/lib/manifests';
import './globals.css';

// display face for a few moments only. greek and cyrillic included, see thinking/10-design.md
const display = Commissioner({
  subsets: ['latin', 'greek', 'cyrillic'],
  variable: '--font-display-face',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Custock', template: '%s · Custock' },
  description: 'A clean blend of Customer and Stock.',
  applicationName: 'Custock',
  icons: appIcons(),
  // the manifest is set where it belongs: the staff app (/ and /admin) or a business (/s/<org>)
  appleWebApp: { capable: true, title: 'Custock', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F3F3F0' },
    { media: '(prefers-color-scheme: dark)', color: '#0F0F12' },
  ],
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const locale = await getLocale();
  return (
    // suppressHydrationWarning: public/theme.js may set data-theme on <html> before react starts
    <html lang={locale} className={display.variable} suppressHydrationWarning>
      <head>
        {/* the appearance picked on this device, applied before the first paint so dark never flashes
            light. a plain file under the base path, so the content security policy needs no inline script */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- it has to run before the first paint */}
        <script src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/theme.js`} />
      </head>
      <body>
        <I18nProvider locale={locale}>
          <ToastProvider>{children}</ToastProvider>
          <PwaRoot />
          <ReportErrors />
        </I18nProvider>
      </body>
    </html>
  );
}
