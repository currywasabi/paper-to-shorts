import { AbsoluteFill, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import type { Attachment, Cut, Scene, ShortScript } from '../schema';
import { layoutScenes, toFrames } from './layout';

export interface ShortsVideoProps {
  script: ShortScript;
}

/** 배경 — 지금은 실제 PDF 크롭 이미지 없이, 어느 페이지를 쓸지만 표시하는 자리표시자. */
function CutView({ cut }: { cut: Cut }) {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#22283a',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ color: '#7c8db5', fontSize: 26, fontFamily: 'system-ui, sans-serif' }}>
        cut: PDF p.{cut.page} (placeholder)
      </div>
    </AbsoluteFill>
  );
}

/** 테이프 붙이듯 화면에 삐딱하게 쾅 튀어나오는 강조 문구. */
function AttachmentView({ attachment }: { attachment: Attachment }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 9, stiffness: 180 } });

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          transform: `scale(${scale}) rotate(-6deg)`,
          background: '#fff4cc',
          color: '#1a1a1a',
          padding: '20px 32px',
          fontSize: 40,
          fontWeight: 800,
          borderRadius: 4,
          boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {attachment.text}
      </div>
    </AbsoluteFill>
  );
}

function SceneView({ scene }: { scene: Scene }) {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: '#0f0f14' }}>
      {scene.cut && (
        <Sequence from={toFrames(scene.cut.startOffset, fps)} durationInFrames={toFrames(scene.cut.duration, fps)}>
          <CutView cut={scene.cut} />
        </Sequence>
      )}

      {scene.attachment && (
        <Sequence
          from={toFrames(scene.attachment.startOffset, fps)}
          durationInFrames={toFrames(scene.attachment.duration, fps)}
        >
          <AttachmentView attachment={scene.attachment} />
        </Sequence>
      )}

      {/* effect는 아직 렌더링하지 않는다 — 실제 에셋 생기면 여기에 연결 */}

      {/* text(나레이션) 디버그 표시 — 실제 서비스에선 자막으로 안 보여줄 예정, 지금은 음성이 없어 확인용 */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          right: 16,
          fontSize: 13,
          color: 'rgba(255,255,255,0.55)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {scene.text}
      </div>
    </AbsoluteFill>
  );
}

/** 장면 배열 + 고정 제목으로 구성된 최소 구성의 Remotion 컴포지션. */
export function ShortsVideo({ script }: ShortsVideoProps) {
  const { fps } = useVideoConfig();
  const positioned = layoutScenes(script.scenes, fps);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {positioned.map(({ scene, from, durationInFrames }, i) => (
        <Sequence key={i} from={from} durationInFrames={durationInFrames}>
          <SceneView scene={scene} />
        </Sequence>
      ))}

      <div
        style={{
          position: 'absolute',
          top: 24,
          left: 16,
          right: 16,
          textAlign: 'center',
          fontSize: 42,
          fontWeight: 800,
          color: '#fff',
          textShadow: '0 2px 10px rgba(0,0,0,0.6)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {script.title}
      </div>
    </AbsoluteFill>
  );
}
