import { useState } from 'react';

import { getSupabaseClient } from '../lib/supabaseClient';
import { useSession } from '../lib/useSession';

/** 우상단(또는 상단바)에 두는 최소한의 로그인 상태 표시. 채널 사이드바는 다음 단계. */
function AuthButton() {
  const { session, loading } = useSession();
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (signInError) setError(signInError.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인을 시작할 수 없습니다.');
    }
  }

  async function signOut() {
    setError(null);
    try {
      const supabase = getSupabaseClient();
      await supabase.auth.signOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그아웃에 실패했습니다.');
    }
  }

  if (loading) return null;

  if (session) {
    return (
      <div className="auth-status">
        <span>{session.user.email}</span>
        <button type="button" onClick={signOut}>
          로그아웃
        </button>
      </div>
    );
  }

  return (
    <div className="auth-status">
      <button type="button" onClick={signIn}>
        Google로 로그인
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

export default AuthButton;
