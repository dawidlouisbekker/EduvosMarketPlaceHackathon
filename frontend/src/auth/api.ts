import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Base URL of the reverse proxy. On web the app is served by the proxy itself, so API calls are
 * same-origin. Native builds need the proxy's address, e.g. EXPO_PUBLIC_API_URL=http://192.168.1.10:8080
 */
export const API_URL = Platform.OS === 'web' ? '' : (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080');

const TOKEN_KEY = 'session-token';

export async function getToken(): Promise<string | null> {
  return Platform.OS === 'web' ? null : SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string | null): Promise<void> {
  if (Platform.OS === 'web') return;
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * fetch() for the backend. Web relies on the HttpOnly session cookie; native sends the bearer token.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = await getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}/api${path}`, { ...init, headers, credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? 'error', body.message ?? res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
