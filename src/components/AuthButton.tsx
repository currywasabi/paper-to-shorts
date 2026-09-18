import { useState } from 'react';

import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { getSupabaseClient } from '../lib/supabaseClient';
import { useSession } from '../lib/useSession';

/** 사이드바 최하단에 두는 로그인 상태 표시. 로그인 상태에서는 클릭 시 모달로 로그아웃을 안내한다. */
function AuthButton() {
  const { session, loading } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);

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
      setLogoutOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그아웃에 실패했습니다.');
    }
  }

  if (loading) return null;

  if (session) {
    return (
      <>
        <button
          type="button"
          onClick={() => setLogoutOpen(true)}
          className="flex w-full items-center gap-2 truncate rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
        >
          <span className="truncate">{session.user.email}</span>
        </button>

        <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>로그아웃</DialogTitle>
              <DialogDescription>{session.user.email} 계정에서 로그아웃할까요?</DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLogoutOpen(false)}>
                취소
              </Button>
              <Button type="button" variant="destructive" onClick={signOut}>
                로그아웃
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button type="button" className="w-full" onClick={signIn}>
        Google로 로그인
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}

export default AuthButton;
