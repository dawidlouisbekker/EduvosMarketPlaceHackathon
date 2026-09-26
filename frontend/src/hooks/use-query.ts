import { useEffect, useState, useSyncExternalStore } from 'react';

import { getVersion, subscribe } from '@/mock/api';

type QueryState<T> = { data: T | undefined; loading: boolean; error: string | null };

/**
 * Runs `fn` on mount, whenever `key` changes, and after any mutation (the mock store's version bumps).
 * Keeps the previous data while refetching so lists don't flash.
 */
export function useQuery<T>(key: string, fn: () => Promise<T>): QueryState<T> & { reload: () => void } {
  const version = useSyncExternalStore(subscribe, getVersion, getVersion);
  const [state, setState] = useState<QueryState<T>>({ data: undefined, loading: true, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    fn().then(
      (data) => alive && setState({ data, loading: false, error: null }),
      (e: unknown) => alive && setState((s) => ({ ...s, loading: false, error: String(e) })),
    );
    return () => {
      alive = false;
    };
    // fn is recreated every render; key identifies what it fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/** Re-renders whenever the mock store changes. */
export function useStoreVersion() {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}
