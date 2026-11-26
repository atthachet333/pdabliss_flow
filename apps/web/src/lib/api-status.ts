import { useCallback, useEffect, useState } from 'react';

export type ApiStatus =
  | { state: 'checking' }
  | { state: 'online'; service: string; checkedAt: Date }
  | { state: 'offline'; reason: string; checkedAt: Date };

/** Real check of the local API's /health (via the Vite dev proxy). Never faked. */
export function useApiStatus(timeoutMs = 3000) {
  const [status, setStatus] = useState<ApiStatus>({ state: 'checking' });

  const check = useCallback(async () => {
    setStatus({ state: 'checking' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('/api/health', {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: unknown = await res.json();
      const service =
        typeof body === 'object' &&
        body !== null &&
        'service' in body &&
        typeof body.service === 'string'
          ? body.service
          : 'unknown';
      if (!(
        typeof body === 'object' &&
        body !== null &&
        'status' in body &&
        body.status === 'ok'
      )) {
        throw new Error('Unexpected health payload');
      }
      setStatus({ state: 'online', service, checkedAt: new Date() });
    } catch (err) {
      const reason =
        err instanceof DOMException && err.name === 'AbortError' ? 'หมดเวลารอ' : 'เชื่อมต่อไม่ได้';
      setStatus({ state: 'offline', reason, checkedAt: new Date() });
    } finally {
      clearTimeout(timer);
    }
  }, [timeoutMs]);

  useEffect(() => {
    void check();
  }, [check]);

  return { status, recheck: check };
}
