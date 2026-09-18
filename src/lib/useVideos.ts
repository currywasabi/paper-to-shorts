import { useCallback, useEffect, useState } from 'react';

import { listVideos, type VideoSummary } from './channels';
import { useSession } from './useSession';

export interface UseVideosResult {
  videos: VideoSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** channelId가 null이면 "전체" 채널 — 선택된 채널이 바뀔 때마다 다시 불러온다. */
export function useVideos(channelId: string | null): UseVideosResult {
  const { session } = useSession();
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setVideos([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setVideos(await listVideos(channelId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '영상 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [session, channelId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { videos, loading, error, refresh };
}
