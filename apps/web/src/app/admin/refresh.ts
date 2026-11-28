/**
 * Explicit, observable refresh for Administration Center read-outs (ADM08 quota, ADM09 health).
 *
 * - Single flight: a click while a request is running joins it; no duplicate server/LINE read.
 * - Every refresh is a real request (the server does not cache quota or health reads).
 * - Success feedback appears only after a request completed and the payload says the read
 *   itself succeeded (`judge`). A completed check that reports a degraded service says so.
 * - Failure keeps the previous valid data on screen, marked stale, with an explicit message.
 * - Timestamps come from completed requests only (the server's own check time when present).
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';

export type Verdict = 'ok' | 'degraded' | 'failed';

export interface RefreshState<T> {
  data: T | null;
  /** loading = first read; refreshing = explicit refresh while data is shown. */
  phase: 'idle' | 'loading' | 'refreshing';
  feedback: { tone: 'success' | 'caution' | 'error'; text: string } | null;
  /** The shown data is older than the latest attempt (that attempt failed). */
  stale: boolean;
  /** Completion time (ISO) of the last request that returned data. */
  checkedAt: string | null;
  error: unknown;
}

export interface RefreshOptions<T> {
  judge: (data: T) => Verdict;
  text: { ok: string; degraded: string; failed: string };
  /** Server-reported check time, if the payload carries one. */
  checkedAtOf?: (data: T) => string | null;
  /** Data to keep when a completed read failed but the previous data is better. */
  merge?: (previous: T | null, next: T, verdict: Verdict) => T;
  now?: () => Date;
}

export class RefreshController<T> {
  private state: RefreshState<T> = {
    data: null,
    phase: 'idle',
    feedback: null,
    stale: false,
    checkedAt: null,
    error: null,
  };
  private inflight: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  /** Number of fetches actually started (tests and diagnostics). */
  started = 0;

  constructor(
    private readonly fetcher: () => Promise<T>,
    private readonly opts: RefreshOptions<T>,
  ) {}

  getState = (): RefreshState<T> => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<RefreshState<T>>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  isBusy = (): boolean => this.inflight !== null;

  /** First read (no success message) — also single flight. */
  load(): Promise<void> {
    return this.run(false);
  }

  /** Explicit user refresh: always a new request unless one is already running. */
  refresh(): Promise<void> {
    return this.run(true);
  }

  private run(announce: boolean): Promise<void> {
    if (this.inflight) return this.inflight;
    const now = this.opts.now ?? (() => new Date());
    this.set({
      phase: this.state.data === null ? 'loading' : 'refreshing',
      ...(announce ? { feedback: null } : {}),
    });
    this.started += 1;
    const p = (async () => {
      try {
        const next = await this.fetcher();
        const verdict = this.opts.judge(next);
        const data = this.opts.merge ? this.opts.merge(this.state.data, next, verdict) : next;
        this.set({
          data,
          phase: 'idle',
          error: null,
          stale: verdict === 'failed' && this.state.data !== null,
          checkedAt: this.opts.checkedAtOf?.(next) ?? now().toISOString(),
          feedback:
            announce || verdict !== 'ok'
              ? {
                  tone: verdict === 'ok' ? 'success' : verdict === 'degraded' ? 'caution' : 'error',
                  text: this.opts.text[verdict],
                }
              : null,
        });
      } catch (error) {
        // Network or API failure: keep whatever valid data is on screen, say it is stale.
        this.set({
          phase: 'idle',
          error,
          stale: this.state.data !== null,
          feedback: { tone: 'error', text: this.opts.text.failed },
        });
      } finally {
        this.inflight = null;
      }
    })();
    this.inflight = p;
    return p;
  }
}

/** React binding: one controller per mounted page, first read on mount. */
export function useRefresh<T>(fetcher: () => Promise<T>, opts: RefreshOptions<T>) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ctl = useMemo(() => new RefreshController(fetcher, opts), []);
  const state = useSyncExternalStore(ctl.subscribe, ctl.getState, ctl.getState);
  useEffect(() => {
    void ctl.load();
  }, [ctl]);
  return { ...state, refresh: () => void ctl.refresh(), busy: state.phase !== 'idle' };
}
