/**
 * Change signal: mutations call bump() when they finish, and mounted queries (hooks/use-query.ts, components/feed.tsx)
 * refetch.
 */
let version = 0;
const listeners = new Set<() => void>();

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getVersion = () => version;

export function bump() {
  version++;
  listeners.forEach((l) => l());
}

/** Runs a mutation, then refreshes the UI whether it succeeded or not (so optimistic UI falls back to the server state). */
export async function mutate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    bump();
  }
}
