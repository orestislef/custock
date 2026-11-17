import type { Metadata, Viewport } from 'next';
import { Commissioner } from 'next/font/google';
import { getLocale } from '@/lib/i18n-server';
import { I18nProvider } from '@/lib/i18n-client';
import { ToastProvider } from '@/components/ui/client-kit';
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
    <html lang={locale} className={display.variable}>
      <body>
        <I18nProvider locale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
