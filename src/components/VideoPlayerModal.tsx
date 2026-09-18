import { useEffect } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Player } from '@remotion/player';
import { X } from 'lucide-react';

import { incrementVideoView, type VideoSummary } from '../lib/channels';
import { totalDurationInFrames } from '../remotion/layout';
import { ShortsVideo } from '../remotion/ShortsVideo';

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

export interface VideoPlayerModalProps {
  video: VideoSummary | null;
  onOpenChange: (open: boolean) => void;
}

/** 갤러리 카드를 눌렀을 때 뜨는 쇼츠/릴스 스타일 재생 뷰 — 배경은 블러+반투명으로 어둡게,
 * 영상은 화면 대부분을 채우는 세로 전체화면 플레이어로 보여준다. */
function VideoPlayerModal({ video, onOpenChange }: VideoPlayerModalProps) {
  const videoId = video?.id;

  // 모달이 다른 영상으로 열릴 때마다 한 번씩 조회수를 올린다. 실패해도 재생 자체를 막을 이유는 없다.
  useEffect(() => {
    if (!videoId) return;
    incrementVideoView(videoId).catch((err) => {
      console.warn('[video] 조회수 반영 실패', err);
    });
  }, [videoId]);

  return (
    <DialogPrimitive.Root open={video !== null} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xl duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          {video && (
            <div className="relative flex flex-col items-center gap-3">
              <DialogPrimitive.Title className="sr-only">{video.title}</DialogPrimitive.Title>

              <div className="overflow-hidden rounded-3xl shadow-2xl ring-1 ring-white/10">
                <Player
                  component={ShortsVideo}
                  inputProps={{ script: video.script }}
                  durationInFrames={totalDurationInFrames(video.script.scenes, FPS)}
                  fps={FPS}
                  compositionWidth={WIDTH}
                  compositionHeight={HEIGHT}
                  style={{ height: 'min(82vh, 820px)', width: 'auto', aspectRatio: `${WIDTH} / ${HEIGHT}` }}
                  acknowledgeRemotionLicense
                  controls
                  loop
                  autoPlay
                />
              </div>

              <p className="max-w-xs truncate text-center text-sm font-medium text-white/90">{video.title}</p>

              <DialogPrimitive.Close
                aria-label="닫기"
                className="absolute -top-3 -right-3 flex size-9 items-center justify-center rounded-full bg-white text-foreground shadow-lg transition-transform hover:scale-105"
              >
                <X className="size-5" />
              </DialogPrimitive.Close>
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default VideoPlayerModal;
