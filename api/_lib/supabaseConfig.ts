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
    rawKey.toLowerCase().includes('service_role');

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
