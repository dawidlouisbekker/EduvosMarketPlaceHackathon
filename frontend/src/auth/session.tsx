import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { API_URL, ApiError, apiFetch, setToken } from './api';

export type Me = {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
};

type Session = {
  user: Me | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

const SSO_ATTEMPTED = 'sso-attempted';

function base64url(input: string): string {
  return input.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomVerifier(): string {
  const bytes = Crypto.getRandomBytes(32);
  return base64url(btoa(String.fromCharCode(...bytes)));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return base64url(digest);
}

/** Web: once per browser session, try a silent sign-in using an existing Microsoft session. */
function trySilentSso(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.has('sso') || params.has('auth_error') || sessionStorage.getItem(SSO_ATTEMPTED)) return false;
  sessionStorage.setItem(SSO_ATTEMPTED, '1');
  const returnTo = window.location.pathname + window.location.search;
  window.location.assign(`/api/auth/login?prompt=none&return_to=${encodeURIComponent(returnTo)}`);
  return true;
}

/** Web: the backend sends failed interactive sign-ins back with `?auth_error=<code>`. */
function initialError(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null; // native, or static rendering
  const authError = new URLSearchParams(window.location.search).get('auth_error');
  return authError && authError !== 'access_denied' ? `Sign-in failed (${authError})` : null;
}

type LoadResult = { user: Me | null; error: string | null; redirecting: boolean };

async function loadSession(): Promise<LoadResult> {
  try {
    return { user: await apiFetch<Me>('/me'), error: null, redirecting: false };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return { user: null, error: null, redirecting: Platform.OS === 'web' && trySilentSso() };
    }
    return { user: null, error: e instanceof Error ? e.message : String(e), redirecting: false };
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(initialError);

  const apply = useCallback((result: LoadResult) => {
    if (result.redirecting) return;
    setUser(result.user);
    if (result.error) setError(result.error);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => apply(await loadSession()), [apply]);

  useEffect(() => {
    loadSession().then(apply);
  }, [apply]);

  const signIn = useCallback(async () => {
    setError(null);
    if (Platform.OS === 'web') {
      const returnTo = window.location.pathname;
      window.location.assign(`/api/auth/login?return_to=${encodeURIComponent(returnTo)}`);
      return;
    }
    // Native: backend-driven Entra login in the system browser (shares its Microsoft session),
    // handed back to the app as a one-time code bound to our own PKCE verifier.
    const verifier = randomVerifier();
    const redirectUri = Linking.createURL('auth');
    const loginUrl =
      `${API_URL}/api/auth/login?client=app` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code_challenge=${await challengeFor(verifier)}`;
    const result = await WebBrowser.openAuthSessionAsync(loginUrl, redirectUri, { preferEphemeralSession: false });
    if (result.type !== 'success') return;

    const { queryParams } = Linking.parse(result.url);
    const code = queryParams?.code;
    if (typeof code !== 'string') {
      setError(`Sign-in failed (${queryParams?.error ?? 'no code returned'})`);
      return;
    }
    try {
      const { token } = await apiFetch<{ token: string }>('/auth/app/exchange', {
        method: 'POST',
        body: JSON.stringify({ code, code_verifier: verifier }),
      });
      await setToken(token);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [refresh]);

  const signOut = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    await setToken(null);
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ user, loading, error, signIn, signOut, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}
