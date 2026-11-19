// a signed in device in plain words: which browser on which system, read from the user agent.
// the home screen app on an iPhone or iPad has no "Safari" in its user agent, that is how it shows.

export const DEVICE_BROWSERS = ['chrome', 'safari', 'firefox', 'edge', 'opera', 'samsung', 'app', 'other'] as const;
export const DEVICE_SYSTEMS = ['windows', 'mac', 'iphone', 'ipad', 'android', 'linux', 'chromeos', 'other'] as const;
export type DeviceBrowser = (typeof DEVICE_BROWSERS)[number];
export type DeviceSystem = (typeof DEVICE_SYSTEMS)[number];

// one signed in device: a sign in and every refresh after it
export interface SessionDevice {
  id: string;
  current: boolean;
  browser: DeviceBrowser;
  os: DeviceSystem;
  lastUsedAt: number;
  signedInAt: number;
}

export function deviceOf(userAgent: string | null | undefined): { browser: DeviceBrowser; os: DeviceSystem } {
  const ua = userAgent ?? '';
  const os: DeviceSystem = /iPhone|iPod/.test(ua) ? 'iphone'
    : /iPad/.test(ua) ? 'ipad'
      : /Android/.test(ua) ? 'android'
        : /CrOS/.test(ua) ? 'chromeos'
          : /Windows/.test(ua) ? 'windows'
            : /Macintosh|Mac OS X/.test(ua) ? 'mac'
              : /Linux/.test(ua) ? 'linux'
                : 'other';
  const browser: DeviceBrowser = /Edg(?:e|A|iOS)?\//.test(ua) ? 'edge'
    : /OPR\/|Opera/.test(ua) ? 'opera'
      : /SamsungBrowser/.test(ua) ? 'samsung'
        : /Firefox\/|FxiOS/.test(ua) ? 'firefox'
          : /CriOS|Chrome\/|Chromium/.test(ua) ? 'chrome'
            : (os === 'iphone' || os === 'ipad') && /AppleWebKit/.test(ua) && !/Safari\//.test(ua) ? 'app'
              : /Safari\//.test(ua) ? 'safari'
                : 'other';
  return { browser, os };
}
