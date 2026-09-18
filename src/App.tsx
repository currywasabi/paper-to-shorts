import { useState } from 'react';

import ChannelSidebar from './components/ChannelSidebar';
import VideoGallery from './components/VideoGallery';
import { useChannels } from './lib/useChannels';
import { useSession } from './lib/useSession';
import { useVideos } from './lib/useVideos';

function App() {
  const { session, loading: sessionLoading } = useSession();
  // null = "전체" — 실제 channel_id가 아니라 모든 채널의 영상을 합쳐 보여주는 가상 항목.
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const { channels, loading: channelsLoading, create: createChannel } = useChannels();
  const { videos, loading: videosLoading, error: videosError, refresh: refreshVideos } = useVideos(selectedChannelId);

  return (
    <div className="flex h-svh flex-col">
      <header className="flex flex-none items-center border-b border-border bg-white px-5 py-2">
        <img src="/logo.svg" alt="Paper to Shorts" className="h-12" />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[260px] flex-none border-r border-border bg-secondary/40">
          <ChannelSidebar
            channels={channels}
            loading={channelsLoading}
            selectedChannelId={selectedChannelId}
            onSelect={setSelectedChannelId}
            onCreate={createChannel}
          />
        </aside>
        <main className="flex-1 overflow-hidden p-6">
          {!session && !sessionLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              로그인하면 채널과 영상을 볼 수 있습니다.
            </div>
          ) : (
            <VideoGallery
              channels={channels}
              selectedChannelId={selectedChannelId}
              videos={videos}
              loading={videosLoading}
              error={videosError}
              onSaved={refreshVideos}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
