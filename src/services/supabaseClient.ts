import { createClient, SupabaseClient, User, Session } from '@supabase/supabase-js';

export const SUPABASE_STORAGE_BUCKET = 'german-learning';

export interface SupabaseRuntimeConfig {
  configured: boolean;
  url: string;
  publishableKey: string;
  bucket: string;
}

let supabaseInstance: SupabaseClient | null = null;
let initPromise: Promise<SupabaseClient | null> | null = null;
let cachedConfig: SupabaseRuntimeConfig = {
  configured: false,
  url: '',
  publishableKey: '',
  bucket: SUPABASE_STORAGE_BUCKET,
};

function isSafePublishableKey(key: string): boolean {
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return false;
  if (key.toLowerCase().includes('service_role')) return false;
  return true;
}

/**
 * Initializes the official @supabase/supabase-js client from runtime config
 * (/api/supabase/config backed by SUPABASE_URL & SUPABASE_PUBLISHABLE_KEY)
 * or VITE_SUPABASE_* client env vars. Never uses secret/service_role keys.
 */
export async function initSupabaseClient(): Promise<SupabaseClient | null> {
  if (supabaseInstance) return supabaseInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const envUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
      const envKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();

      if (envUrl && envKey && isSafePublishableKey(envKey)) {
        cachedConfig = {
          configured: true,
          url: envUrl,
          publishableKey: envKey,
          bucket: SUPABASE_STORAGE_BUCKET,
        };
        supabaseInstance = createClient(envUrl, envKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        });
        return supabaseInstance;
      }

      const res = await fetch('/api/supabase/config', { cache: 'no-store' });
      if (!res.ok) {
        return null;
      }

      const json = await res.json();
      const data = json?.data;
      if (
        data?.configured &&
        typeof data.url === 'string' &&
        typeof data.publishableKey === 'string' &&
        isSafePublishableKey(data.publishableKey)
      ) {
        cachedConfig = {
          configured: true,
          url: data.url,
          publishableKey: data.publishableKey,
          bucket: data.bucket || SUPABASE_STORAGE_BUCKET,
        };
        supabaseInstance = createClient(data.url, data.publishableKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        });
        return supabaseInstance;
      }

      cachedConfig = {
        configured: false,
        url: '',
        publishableKey: '',
        bucket: SUPABASE_STORAGE_BUCKET,
      };
      return null;
    } catch (err) {
      console.error('Failed to initialize Supabase client:', err);
      return null;
    }
  })();

  return initPromise;
}

export function getSupabaseClientSync(): SupabaseClient | null {
  return supabaseInstance;
}

export function getSupabaseConfigStatus(): SupabaseRuntimeConfig {
  return { ...cachedConfig };
}

export async function signUpWithEmail(
  email: string,
  password: string
): Promise<{ user: User | null; session: Session | null; needsEmailConfirmation: boolean }> {
  const client = await initSupabaseClient();
  if (!client) {
    throw new Error(
      'Supabase غير مضبوط بعد. يرجى ضبط متغيرات SUPABASE_URL و SUPABASE_PUBLISHABLE_KEY على الخادم.'
    );
  }
  const { data, error } = await client.auth.signUp({
    email: email.trim(),
    password,
  });
  if (error) throw new Error(error.message);
  return {
    user: data.user,
    session: data.session,
    needsEmailConfirmation: Boolean(data.user && !data.session),
  };
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<{ user: User | null; session: Session | null }> {
  const client = await initSupabaseClient();
  if (!client) {
    throw new Error(
      'Supabase غير مضبوط بعد. يرجى ضبط متغيرات SUPABASE_URL و SUPABASE_PUBLISHABLE_KEY على الخادم.'
    );
  }
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw new Error(error.message);
  return { user: data.user, session: data.session };
}

export async function signOutFromSupabase(): Promise<void> {
  const client = await initSupabaseClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function getCurrentSupabaseUser(): Promise<User | null> {
  const client = await initSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}
