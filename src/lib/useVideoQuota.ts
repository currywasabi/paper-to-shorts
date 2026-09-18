import { useCallback, useEffect, useState } from 'react';

import { getVideoCount } from './channels';
import { useSession } from './useSession';

export interface UseVideoQuotaResult {
  count: number | null;
  refresh: () => Promise<void>;
}

/** 사이드바 계정 영역 위에 "N/5개 저장됨"을 띄우기 위한 전체 영상 개수. */
export function useVideoQuota(): UseVideoQuotaResult {
  const { session } = useSession();
  const [count, setCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setCount(null);
      return;
    }
    try {
      setCount(await getVideoCount());
    } catch (err) {
      console.warn('[quota] 영상 개수를 불러오지 못함', err);
    }
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { count, refresh };
}
