import { useCallback, useEffect, useState } from 'react';

import { createChannel, listChannels, type Channel } from './channels';
import { useSession } from './useSession';

export interface UseChannelsResult {
  channels: Channel[];
  loading: boolean;
  error: string | null;
  create: (name: string) => Promise<Channel>;
}

/** 로그인 세션에 맞춰 채널 목록을 불러오고, 새 채널 생성 시 로컬 목록에 바로 반영한다. */
export function useChannels(): UseChannelsResult {
  const { session } = useSession();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setChannels([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setChannels(await listChannels());
    } catch (err) {
      setError(err instanceof Error ? err.message : '채널 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (name: string) => {
    const channel = await createChannel(name);
    setChannels((prev) => [...prev, channel]);
    return channel;
  }, []);

  return { channels, loading, error, create };
}
