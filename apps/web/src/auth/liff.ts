/**
 * Real LIFF adapter (official SDK `@line/liff`, ≥ 2.32.0 — older 2.20–2.31 releases are
 * being restricted by LINE). Loaded lazily so non-LIFF screens stay light.
 */
import type { LiffPort } from './types';

export async function loadRealLiff(): Promise<LiffPort> {
  const { default: liff } = await import('@line/liff');
  return {
    init: (liffId) => liff.init({ liffId }),
    isInClient: () => liff.isInClient(),
    isLoggedIn: () => liff.isLoggedIn(),
    login: (redirectUri) => liff.login({ redirectUri }),
    logout: () => liff.logout(),
    getIDToken: () => liff.getIDToken(),
    getIdTokenExp: () => liff.getDecodedIDToken()?.exp ?? null,
  };
}
