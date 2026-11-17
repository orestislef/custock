// one api for the whole app. with EXPO_PUBLIC_API_URL set it talks to the real server,
// otherwise it runs on the built in demo data, so the app works on its own.

import { createApiClient, type CustockApi, type Locale } from '@custock/core';
import Constants from 'expo-constants';

import { createFixtureApi } from './fixtures';
import { currentLocale } from './i18n';

let accessToken: string | null = null;
const permsVersions = new Map<string, number>();
let onUnauthorized: (() => void) | null = null;
let onPermsStale: ((orgId: string) => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function setPermsVersion(orgId: string, v: number) {
  permsVersions.set(orgId, v);
}
export function onAuthLost(fn: () => void) {
  onUnauthorized = fn;
}
export function onAccessChanged(fn: (orgId: string) => void) {
  onPermsStale = fn;
}

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };
export const API_URL: string | null = process.env.EXPO_PUBLIC_API_URL || extra.apiUrl || null;
export const USING_FIXTURES = !API_URL;

export const api: CustockApi = API_URL
  ? createApiClient({
      baseUrl: API_URL,
      getAccessToken: () => accessToken,
      getLocale: () => currentLocale(),
      getPermsVersion: (orgId) => permsVersions.get(orgId),
      onUnauthorized: () => onUnauthorized?.(),
      onPermsStale: (orgId) => onPermsStale?.(orgId),
    })
  : createFixtureApi(() => accessToken, () => currentLocale() as Locale);

// error code from either the real client or the fixtures, for the common.error.* translations
export function errorCode(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') return (e as { code: string }).code;
  if (e instanceof TypeError) return 'offline';
  return 'internal';
}
