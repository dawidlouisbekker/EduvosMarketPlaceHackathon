import type { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { Error as ErrorMessage } from '@/gen/incubator/v1/common';

/**
 * Base URL of the reverse proxy. On web the app is served by the proxy itself, so API calls are
 * same-origin. Native builds need the proxy's address, e.g. EXPO_PUBLIC_API_URL=http://192.168.1.10:8080
 */
export const API_URL = Platform.OS === 'web' ? '' : (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080');

const TOKEN_KEY = 'session-token';
const PROTOBUF = 'application/x-protobuf';

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

/** Encoder/decoder of a generated message (src/gen). */
export type Codec<T> = {
  encode(message: T, writer?: BinaryWriter): BinaryWriter;
  decode(input: BinaryReader | Uint8Array, length?: number): T;
};

type Options<Req, Res> = {
  /** Request message, sent as the protobuf body. */
  body?: [Codec<Req>, Req];
  /** Response message to decode. Omit for 204 endpoints. */
  response?: Codec<Res>;
};

/**
 * Calls the backend with protobuf bodies (docs/adr/0001-protobuf-api-contracts.md).
 * Web relies on the HttpOnly session cookie; native sends the bearer token.
 * Non-2xx responses throw an ApiError decoded from `incubator.v1.Error`.
 */
export async function protoFetch<Res = void, Req = never>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  { body, response }: Options<Req, Res> = {},
): Promise<Res> {
  const headers = new Headers({ Accept: PROTOBUF });
  if (body) headers.set('Content-Type', PROTOBUF);
  const token = await getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers,
    body: body ? body[0].encode(body[1]).finish() : undefined,
    credentials: 'include',
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) {
    const isProto = res.headers.get('Content-Type')?.startsWith(PROTOBUF);
    const error = isProto ? ErrorMessage.decode(bytes) : { code: 'error', message: res.statusText };
    throw new ApiError(res.status, error.code || 'error', error.message || res.statusText);
  }
  return (response ? response.decode(bytes) : undefined) as Res;
}

/** Builds `?a=1&b=2`, skipping empty values. */
export function query(params: Record<string, string | number | null | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
