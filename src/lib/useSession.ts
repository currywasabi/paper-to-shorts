import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { getSupabaseClient } from './supabaseClient';

export interface SessionState {
  session: Session | null;
  // env 미설정 등으로 Supabase 자체를 못 쓰는 상태와, "로그인 확인 중"을 구분한다.
  loading: boolean;
}

/** 현재 로그인 세션을 구독한다. Supabase env가 없으면 조용히 "로그인 안 됨"으로 취급한다
 * (기존 PdfPanel/ScriptStudio는 로그인 없이도 동작해야 하므로 여기서 에러를 던지지 않는다). */
export function useSession(): SessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // env 미설정 여부는 런타임 중에 바뀌지 않으므로 한 번만 계산한다 — effect 진입 자체를 건너뛰기
  // 위한 값이라 여기서 미리 판단해두고, "로딩 아님" 여부는 아래 return에서 바로 파생한다.
  const [available] = useState(() => {
    try {
      getSupabaseClient();
      return true;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!available) return;
    const supabase = getSupabaseClient();

    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setSession(data.session);
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [available]);

  return { session, loading: available && loading };
}
