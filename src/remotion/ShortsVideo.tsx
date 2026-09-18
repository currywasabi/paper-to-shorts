import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import type {
  AttachmentBlock,
  Block,
  CutBlock,
  MemeBlock,
  Scene,
  ShortScript,
  SoundBlock,
} from "../schema";
import { layoutScenes, toFrames } from "./layout";

export interface ShortsVideoProps {
  script: ShortScript;
}

/** 배경 — 지금은 실제 PDF 크롭 이미지 없이, 어느 페이지를 쓸지만 표시하는 자리표시자.
 * 화면을 꽉 채우지 않고 위(제목)와 아래(밈/여백)에 공간을 남긴다. */
function CutView({ cut }: { cut: CutBlock }) {
  return (
    <AbsoluteFill
      style={{
        boxSizing: "border-box",
        padding: "260px 0 200px",
        backgroundColor: "#000",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: "#22283a",
          borderRadius: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            color: "#7c8db5",
            fontSize: 26,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          cut: PDF p.{cut.page} (placeholder)
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** 테이프 붙이듯 화면에 삐딱하게 쾅 튀어나오는 강조 문구. */
function AttachmentView({ attachment }: { attachment: AttachmentBlock }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 9, stiffness: 180 } });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          transform: `scale(${scale}) rotate(-6deg)`,
          background: "#fff4cc",
          color: "#1a1a1a",
          padding: "20px 32px",
          fontSize: 40,
          fontWeight: 800,
          borderRadius: 4,
          boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {attachment.text}
      </div>
    </AbsoluteFill>
  );
}

/** public/assets/images의 밈 이미지를 화면 하단 구석에 붙인다. */
function MemeView({ meme }: { meme: MemeBlock }) {
  return (
    <AbsoluteFill
      style={{
        alignItems: "flex-end",
        justifyContent: "flex-end",
        padding: "0 24px 44px 0",
      }}
    >
      <Img
        src={staticFile(`assets/images/${meme.image}`)}
        style={{
          width: 190,
          borderRadius: 14,
          boxShadow: "0 8px 22px rgba(0,0,0,0.55)",
        }}
      />
    </AbsoluteFill>
  );
}

/** public/assets/sounds의 효과음. attachment 등 다른 블록과 무관하게 독립적으로 재생된다.
 * duration만큼만(스키마상 최대 2초) 파일 앞부분을 잘라 쓰고, volume은 스키마에서 이미 상한이 걸려있다. */
function SoundView({ sound }: { sound: SoundBlock }) {
  const { fps } = useVideoConfig();

  return (
    <Audio
      src={staticFile(`assets/sounds/${sound.name}.mp3`)}
      trimBefore={0}
      trimAfter={Math.round(fps * sound.duration)}
      volume={sound.volume}
    />
  );
}

/** 블록 하나를 type에 맞는 뷰로 연결한다. */
function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "cut":
      return <CutView cut={block} />;
    case "attachment":
      return <AttachmentView attachment={block} />;
    case "meme":
      return <MemeView meme={block} />;
    case "sound":
      return <SoundView sound={block} />;
    case "effect":
      // 아직 렌더링하지 않는다 — 실제 에셋/연출 생기면 여기에 연결.
      return null;
  }
}

function SceneView({ scene }: { scene: Scene }) {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#0f0f14" }}>
      {scene.blocks.map((block, i) => (
        <Sequence
          key={i}
          from={toFrames(block.startOffset, fps)}
          durationInFrames={toFrames(block.duration, fps)}
        >
          <BlockView block={block} />
        </Sequence>
      ))}

      {/* text(나레이션) 디버그 표시 — 실제 서비스에선 자막으로 안 보여줄 예정, 지금은 음성이 없어 확인용 */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          right: 16,
          fontSize: 13,
          color: "rgba(255,255,255,0.55)",
          fontFamily: "system-ui, sans-serif",
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
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {positioned.map(({ scene, from, durationInFrames }, i) => (
        <Sequence key={i} from={from} durationInFrames={durationInFrames}>
          <SceneView scene={scene} />
        </Sequence>
      ))}

      <div
        style={{
          position: "absolute",
          top: 100,
          left: 20,
          right: 20,
          textAlign: "center",
          fontSize: 100,
          lineHeight: 1.1,
          fontWeight: 1000,
          color: "#fff",
          letterSpacing: "-0.02em",
          WebkitTextStroke: "2px rgba(0,0,0,0.35)",
          textShadow: "0 4px 18px rgba(0,0,0,0.75)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {script.title}
      </div>
    </AbsoluteFill>
  );
}
