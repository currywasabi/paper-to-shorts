import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** 실제로 필요할 때(추출 버튼 클릭 시)만 생성해서, env 미설정 시에도 뷰어는 동작하게 한다. */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 환경변수가 설정되지 않았습니다. .env.local을 확인하세요.',
    );
  }

  client = createClient(url, anonKey);
  return client;
}
