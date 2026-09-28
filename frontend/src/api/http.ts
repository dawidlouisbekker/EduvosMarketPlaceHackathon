import { ApiError } from '@/auth/api';

export { protoFetch, query } from '@/auth/api';

/** Path segment, e.g. an id or a skill name like "UI/UX Design". */
export const seg = (value: string) => encodeURIComponent(value);

/** Resolves to null when the resource doesn't exist or the viewer may not see it (404). */
export async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
