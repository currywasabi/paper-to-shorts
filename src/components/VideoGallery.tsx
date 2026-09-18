import { useState } from 'react';

import AddVideoModal from './AddVideoModal';
import type { Channel, VideoSummary } from '../lib/channels';

export interface VideoGalleryProps {
  channels: Channel[];
  selectedChannelId: string | null;
  videos: VideoSummary[];
  loading: boolean;
  error: string | null;
  onSaved: () => void;
}

/** 선택된 채널의 영상 보관함. 썸네일 카드들을 나열하고, 그 중 하나로 동영상 추가 카드를 끼워 넣는다. */
function VideoGallery({ channels, selectedChannelId, videos, loading, error, onSaved }: VideoGalleryProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const channelName = selectedChannelId
    ? (channels.find((c) => c.id === selectedChannelId)?.name ?? '채널')
    : '전체';

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">{channelName}</h1>
        {!loading && <span className="font-mono text-sm text-muted-foreground">{videos.length}개 영상</span>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-6 overflow-y-auto pb-2">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex aspect-[9/16] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-secondary/20 text-muted-foreground backdrop-blur-sm transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
        >
          <span className="text-4xl leading-none">+</span>
          <span className="text-base font-medium">동영상 추가</span>
        </button>

        {videos.map((video) => (
          <div key={video.id} className="flex flex-col gap-2">
            <div className="aspect-[9/16] overflow-hidden rounded-2xl border border-border bg-secondary/70 backdrop-blur-sm">
              {video.thumbnailUrl ? (
                <img
                  src={video.thumbnailUrl}
                  alt={video.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                  미리보기 없음
                </div>
              )}
            </div>
            <p className="truncate text-base text-foreground">{video.title}</p>
          </div>
        ))}
      </div>

      <AddVideoModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        channels={channels}
        contextChannelId={selectedChannelId}
        onSaved={onSaved}
      />
    </div>
  );
}

export default VideoGallery;
