import { type Store, StoreTransactionConflictError } from '../store/types.js';

/** Retry replay-safe database work from a fresh snapshot after a confirmed write conflict. */
export async function retryWriteConflict<T>(
  store: Store,
  work: (tx: Store) => Promise<T>,
): Promise<T> {
  const maxAttempts = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      return await store.transaction(work);
    } catch (error) {
      if (!(error instanceof StoreTransactionConflictError) || attempt >= maxAttempts) throw error;
    }
  }
}
