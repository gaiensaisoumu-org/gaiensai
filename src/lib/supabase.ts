import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
);

const BUCKET_NAME = 'performance-images';

export function getPerformanceImageUrl(
  path: string | null,
  cacheVersion?: string | number,
): string {
  if (!path) {
    // 画像が登録されていない場合の「プレースホルダー画像（NO IMAGE）」を設定しておくと親切です
    return '/images/no-image.png';
  }

  // Supabaseクライアントから公開URLを取得
  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(path);
  if (!cacheVersion) {
    return data.publicUrl;
  }

  const url = new URL(data.publicUrl);
  url.searchParams.set('v', String(cacheVersion));
  return url.toString();
}
