import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "./components/ui/button";
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
  // 좁은 화면(모바일 기준선)에선 기본으로 접어서 시작한다 — 이후엔 헤더 토글로 직접 열고 닫는다.
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);

  function handleVideoSaved() {
    refreshVideos();
    refreshVideoQuota();
  }

  return (
    <div className="flex h-svh flex-col">
      <header className="flex flex-none items-center gap-2 border-b border-border bg-white/70 px-3 py-2 backdrop-blur-md">
        {session && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={sidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            {sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
        )}
        <img src="/logo.svg" alt="Paper to Shorts" className="h-5" />
      </header>

      {!session && !sessionLoading ? (
        <main className="min-h-0 flex-1">
          <LoginPrompt />
        </main>
      ) : (
        <div className="relative flex min-h-0 flex-1">
          {/* 모바일에서만: 사이드바 뒤 어두운 배경. 탭하면 닫힘. 데스크탑(md~)에선 안 씀. */}
          {sidebarOpen && (
            <button
              type="button"
              aria-label="사이드바 닫기"
              onClick={() => setSidebarOpen(false)}
              className="absolute inset-0 z-30 bg-black/40 md:hidden"
            />
          )}

          <aside
            className={`absolute inset-y-0 left-0 z-40 w-[260px] flex-none overflow-hidden border-r border-border bg-secondary/95 backdrop-blur-md transition-transform duration-200 md:static md:z-auto md:bg-secondary/30 md:transition-[width] ${
              sidebarOpen
                ? 'translate-x-0 md:w-[260px]'
                : '-translate-x-full md:w-0 md:translate-x-0 md:border-r-0'
            }`}
          >
            <div className="h-full w-[260px]">
              <ChannelSidebar
                channels={channels}
                loading={channelsLoading}
                selectedChannelId={selectedChannelId}
                onSelect={(id) => {
                  setSelectedChannelId(id);
                  if (window.innerWidth < 768) setSidebarOpen(false);
                }}
                onCreate={createChannel}
                onRename={renameChannel}
                onDelete={removeChannel}
                videoQuotaCount={videoQuotaCount}
              />
            </div>
          </aside>
          <main className="min-w-0 flex-1 overflow-hidden p-6">
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
