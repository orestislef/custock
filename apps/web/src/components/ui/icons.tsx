// one icon set: 24 px grid, rounded caps and joins, 1.8 stroke. filled variants for selected tabs.

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number; filled?: boolean };

function make(paths: (filled: boolean) => React.ReactNode, fillable = false) {
  return function Icon({ size = 22, filled = false, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fillable && filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {paths(filled)}
      </svg>
    );
  };
}

export const IconHome = make(() => <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19z" />, true);
export const IconBox = make((f) => (
  <>
    <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
    <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" stroke={f ? 'var(--c-surface)' : 'currentColor'} />
  </>
), true);
export const IconPeople = make(() => (
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5z" />
    <path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18.5 14.8c1.7.7 2.8 2.4 3 5.2h-2.5" fill="none" />
  </>
), true);
export const IconMegaphone = make(() => (
  <>
    <path d="M4 9.5v5h3l8 4.5v-14L7 9.5z" />
    <path d="M18 9a3.5 3.5 0 0 1 0 6M7.5 14.5 9 20h2.5" fill="none" />
  </>
), true);
export const IconChart = make(() => (
  <>
    <rect x="4" y="12" width="4" height="8" rx="1" />
    <rect x="10" y="7" width="4" height="13" rx="1" />
    <rect x="16" y="4" width="4" height="16" rx="1" />
  </>
), true);
export const IconGear = make((f) => (
  <>
    <path d="M10.3 3.5h3.4l.5 2.4 1.7 1 2.3-.8 1.7 2.9-1.8 1.6v2l1.8 1.6-1.7 2.9-2.3-.8-1.7 1-.5 2.4h-3.4l-.5-2.4-1.7-1-2.3.8-1.7-2.9 1.8-1.6v-2L4 8.9l1.7-2.9 2.3.8 1.7-1z" />
    <circle cx="12" cy="12" r="2.8" fill={f ? 'var(--c-surface)' : 'none'} />
  </>
), true);
export const IconMore = make(() => (
  <>
    <circle cx="5.5" cy="12" r="1.4" fill="currentColor" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.4" fill="currentColor" />
  </>
));
export const IconSearch = make(() => (
  <>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 5 5" />
  </>
));
export const IconChevronRight = make(() => <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />);
export const IconChevronLeft = make(() => <path d="M14.5 5.5 8 12l6.5 6.5" />);
export const IconChevronDown = make(() => <path d="m6 9.5 6 6 6-6" />);
export const IconClose = make(() => <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);
export const IconCheck = make(() => <path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconPlus = make(() => <path d="M12 5v14M5 12h14" />);
export const IconMinus = make(() => <path d="M5 12h14" />);
export const IconLock = make(() => (
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="2.2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </>
));
export const IconBarcode = make(() => (
  <>
    <path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7M17 4h1.5A1.5 1.5 0 0 1 20 5.5V7M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H5.5A1.5 1.5 0 0 1 4 18.5V17" />
    <path d="M8 8v8M11 8v8M13.5 8v8M16 8v8" />
  </>
));
export const IconQr = make(() => (
  <>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h2.5v2.5H14zM18 18h2v2h-2zM18 14h2M14 18v2" />
  </>
));
export const IconBell = make(() => (
  <>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" fill="none" />
  </>
), true);
export const IconTag = make(() => (
  <>
    <path d="M3.5 12.4V4.5a1 1 0 0 1 1-1h7.9l8.1 8.1a1.4 1.4 0 0 1 0 2l-6.9 6.9a1.4 1.4 0 0 1-2 0z" />
    <circle cx="8" cy="8" r="1.3" fill="currentColor" />
  </>
));
export const IconMail = make(() => (
  <>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
    <path d="m4.5 7 7.5 6 7.5-6" />
  </>
));
export const IconPhone = make(() => <path d="M7.4 3.5 9.6 8 8 9.4a11 11 0 0 0 6.6 6.6l1.4-1.6 4.5 2.2-.7 3a1.6 1.6 0 0 1-1.7 1.2C10 19.9 4.1 14 3.2 6a1.6 1.6 0 0 1 1.2-1.7z" />);
export const IconShop = make(() => (
  <>
    <path d="M4 9.5V20h16V9.5M3 9.5 5 4h14l2 5.5a2.6 2.6 0 0 1-4.5 1.6 2.6 2.6 0 0 1-4.5 0 2.6 2.6 0 0 1-4.5 0A2.6 2.6 0 0 1 3 9.5z" />
    <path d="M10 20v-5h4v5" />
  </>
));
export const IconShield = make(() => <path d="M12 3.5 5 6v5.5c0 4.4 3 7.7 7 9 4-1.3 7-4.6 7-9V6z" />, true);
export const IconLink = make(() => (
  <>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L12 6.3" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </>
));
export const IconPrint = make(() => (
  <>
    <path d="M7 8V3.5h10V8M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 5 8h14a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 19 17h-2" />
    <path d="M7 14h10v6.5H7z" />
  </>
));
export const IconCalendar = make(() => (
  <>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M4 10h16M8.5 3v4M15.5 3v4" />
  </>
));
export const IconGlobe = make(() => (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.4 2.6 3.5 5.4 3.5 8.5s-1.1 5.9-3.5 8.5c-2.4-2.6-3.5-5.4-3.5-8.5s1.1-5.9 3.5-8.5z" />
  </>
));
export const IconUser = make(() => (
  <>
    <circle cx="12" cy="8.5" r="4" />
    <path d="M4.5 20.5c.9-4 3.8-6 7.5-6s6.6 2 7.5 6z" />
  </>
), true);
export const IconLogout = make(() => (
  <>
    <path d="M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14" />
    <path d="m15.5 8 4 4-4 4M19.5 12H10" />
  </>
));
export const IconHeart = make(() => <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />, true);
export const IconHalf = make(() => (
  <>
    <circle cx="12" cy="12" r="7.5" />
    <path d="M12 4.5a7.5 7.5 0 0 1 0 15z" fill="currentColor" />
  </>
));
export const IconSlash = make(() => (
  <>
    <circle cx="12" cy="12" r="7.5" />
    <path d="m6.8 6.8 10.4 10.4" />
  </>
));
export const IconWarning = make(() => (
  <>
    <path d="M10.4 4.6a1.8 1.8 0 0 1 3.2 0l7 12.6a1.8 1.8 0 0 1-1.6 2.7H5a1.8 1.8 0 0 1-1.6-2.7z" />
    <path d="M12 9.5v4" />
    <circle cx="12" cy="16.6" r="0.6" fill="currentColor" />
  </>
));
export const IconTruck = make(() => (
  <>
    <path d="M3.5 6.5h10v9.5h-10zM13.5 10h4l3 3v3h-7" />
    <circle cx="7.5" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </>
));
export const IconInfo = make(() => (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
  </>
));
export const IconSparkle = make(() => <path d="M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14 3.5 12l6.7-2z" />, true);
export const IconHistory = make(() => (
  <>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6" />
    <path d="M4 4v4.6h4.6M12 8v4.5l3 2" />
  </>
));
export const IconEdit = make(() => <path d="M4.5 19.5 5.5 15 15.8 4.7a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L9 18.5zM13.5 7l3.5 3.5" />);
export const IconArrowIn = make(() => (
  <>
    <path d="M4 13v5.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V13" />
    <path d="M12 3.5v11M8 10.5l4 4 4-4" />
  </>
));
export const IconMailOff = make(() => (
  <>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
    <path d="m4.5 7 7.5 6 7.5-6M3 3l18 18" />
  </>
));
export const IconBellOff = make(() => (
  <>
    <path d="M6 16.5V11a6 6 0 0 1 9.6-4.8M18 11v5.5l1.5 2h-15z" />
    <path d="M10 20.5a2 2 0 0 0 4 0M3 3l18 18" fill="none" />
  </>
));
export const IconClipboard = make(() => (
  <>
    <rect x="5" y="4.5" width="14" height="16" rx="2" />
    <path d="M9 4.5V3.5h6v1M8.5 10h7M8.5 13.5h7M8.5 17h4" />
  </>
));
export const IconCopy = make(() => (
  <>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </>
));
// a viewfinder with a scan line, the scan tab
export const IconScan = make((f) => (
  <>
    <path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5" />
    <path d="M7.5 12h9" strokeWidth={f ? 2.6 : 1.8} />
  </>
));
// the ios share symbol, for the add to home screen steps
export const IconShare = make(() => (
  <>
    <path d="M8.5 9H7a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17 9h-1.5" />
    <path d="M12 3.5v10M8.5 7 12 3.5 15.5 7" />
  </>
));
export const IconAddSquare = make(() => (
  <>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M12 8.5v7M8.5 12h7" />
  </>
));
export const IconTorch = make((f) => (
  <>
    <path d="M8 3.5h8v3l-2 3.5v10a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V10L8 6.5z" fill={f ? 'currentColor' : 'none'} />
    <path d="M8 6.5h8" stroke={f ? 'var(--c-shelf)' : 'currentColor'} />
  </>
), true);
export const IconKeyboard = make(() => (
  <>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 10h.01M10.3 10h.01M13.6 10h.01M17 10h.01M7 13.5h.01M17 13.5h.01M9.5 13.5h5" strokeWidth={2.2} />
  </>
));
export const IconCamera = make(() => (
  <>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2L9 5h6l1.3 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
    <circle cx="12" cy="12.5" r="3.3" />
  </>
));
export const IconClock = make(() => (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>
));
export const IconDownload = make(() => (
  <>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M5 19.5h14" />
  </>
));
export const IconTrash = make(() => (
  <>
    <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7" />
    <path d="M10 11v6M14 11v6" />
  </>
));
export const IconNews = make((f) => (
  <>
    <rect x="4" y="4.5" width="16" height="15" rx="2.5" />
    <path d="M8 9h8M8 12.5h8M8 16h5" stroke={f ? 'var(--c-shelf)' : 'currentColor'} />
  </>
), true);
export const IconWifiOff = make(() => (
  <>
    <path d="M3 9.5a13 13 0 0 1 18 0M6.2 13a8.5 8.5 0 0 1 11.6 0M9.4 16.4a4 4 0 0 1 5.2 0" />
    <path d="M4 4l16 16" />
  </>
));
export const IconPhoneApp = make(() => (
  <>
    <rect x="6.5" y="3" width="11" height="18" rx="2.5" />
    <path d="M10.5 18h3" />
  </>
));
