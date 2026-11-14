export const SUPABASE_STORAGE_BUCKET = 'german-learning';

export interface SupabasePublicConfig {
  configured: boolean;
  url: string;
  publishableKey: string;
  bucket: string;
}

function cleanEnvValue(value?: string): string {
  const trimmed = (value || '').trim();
  return trimmed.replace(/^(['"])(.*)\1$/, '$2').trim();
}

/**
 * Legacy Supabase keys are JWTs; a service_role key is a JWT whose payload has role=service_role
 * (the plain string "service_role" never appears in the encoded token), so decode and check it.
 */
function isServiceRoleJwt(key: string): boolean {
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const url = cleanEnvValue(
    process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL
  );

  const rawKey = cleanEnvValue(
    process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  // Safety guard: never expose service_role or sb_secret_ keys to frontend
  const isSecretKey =
    rawKey.startsWith('sb_secret_') ||
    rawKey.toLowerCase().includes('service_role') ||
    isServiceRoleJwt(rawKey);

  const isPlaceholder =
    !url ||
    !rawKey ||
    url.includes('YOUR_PROJECT_REF') ||
    rawKey === 'MY_SUPABASE_PUBLISHABLE_KEY';

  const publishableKey = isSecretKey || isPlaceholder ? '' : rawKey;
  const configured = Boolean(url && publishableKey && /^https?:\/\//i.test(url));

  return {
    configured,
    url: configured ? url : '',
    publishableKey: configured ? publishableKey : '',
    bucket: SUPABASE_STORAGE_BUCKET,
  };
}
