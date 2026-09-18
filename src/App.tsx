import { useState } from "react";

import ChannelSidebar from "./components/ChannelSidebar";
import LoginPrompt from "./components/LoginPrompt";
import VideoGallery from "./components/VideoGallery";
import { useChannels } from "./lib/useChannels";
import { useSession } from "./lib/useSession";
import { useVideoQuota } from "./lib/useVideoQuota";
import { useVideos } from "./lib/useVideos";

function App() {
  const { session, loading: sessionLoading } = useSession();
  // null = "전체" — 실제 channel_id가 아니라 모든 채널의 영상을 합쳐 보여주는 가상 항목.
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null,
  );
  const {
    channels,
    loading: channelsLoading,
    create: createChannel,
    rename: renameChannel,
    remove: removeChannel,
  } = useChannels();
  const {
    videos,
    loading: videosLoading,
    error: videosError,
    refresh: refreshVideos,
  } = useVideos(selectedChannelId);
  const { count: videoQuotaCount, refresh: refreshVideoQuota } = useVideoQuota();

  function handleVideoSaved() {
    refreshVideos();
    refreshVideoQuota();
  }

  return (
    <div className="flex h-svh flex-col">
      <header className="flex flex-none items-center border-b border-border bg-white/70 px-5 py-2 backdrop-blur-md">
        <img src="/logo.svg" alt="Paper to Shorts" className="h-5" />
      </header>

      {!session && !sessionLoading ? (
        <main className="min-h-0 flex-1">
          <LoginPrompt />
        </main>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="w-[260px] flex-none border-r border-border bg-secondary/30 backdrop-blur-md">
            <ChannelSidebar
              channels={channels}
              loading={channelsLoading}
              selectedChannelId={selectedChannelId}
              onSelect={setSelectedChannelId}
              onCreate={createChannel}
              onRename={renameChannel}
              onDelete={removeChannel}
              videoQuotaCount={videoQuotaCount}
            />
          </aside>
          <main className="flex-1 overflow-hidden p-6">
            <VideoGallery
              channels={channels}
              selectedChannelId={selectedChannelId}
              videos={videos}
              loading={videosLoading}
              error={videosError}
              onSaved={handleVideoSaved}
            />
          </main>
        </div>
      )}
    </div>
  );
}

export default App;
