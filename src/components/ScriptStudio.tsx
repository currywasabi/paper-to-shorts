import { useEffect, useMemo, useState } from 'react';
import { Player } from '@remotion/player';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import { ShortsVideo } from '../remotion/ShortsVideo';
import { totalDurationInFrames } from '../remotion/layout';
import { shortScriptSchema, type ShortScript } from '../schema';

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

const DUMMY_SCRIPT: ShortScript = {
  title: '이 논문 실화냐',
  scenes: [
    {
      text: '이 논문 결과 보고 진짜 놀랐음. 조건 C가 기존보다 압도적으로 좋았음.',
      duration: 4,
      blocks: [{ type: 'cut', page: 1, startOffset: 0, duration: 4 }],
    },
    {
      // cut + attachment + sound + meme을 동시에 조합한 예시. sound는 attachment와 무관하게
      // 독립 블록이라, 원하면 같은 startOffset을 줘서 등장 타이밍만 맞추면 된다.
      text: '핵심 수식은 이거 하나. 이것만 알면 나머지는 다 부가설명임.',
      duration: 5,
      blocks: [
        { type: 'cut', page: 2, startOffset: 0, duration: 5 },
        { type: 'attachment', text: 'S(x) = 0.5·m(x)²+7', startOffset: 1.2, duration: 3.5 },
        { type: 'sound', name: 'pew', startOffset: 1.2, duration: 1.2, volume: 0.35 },
        { type: 'meme', image: 'smilepepe.webp', startOffset: 0, duration: 5 },
      ],
    },
    {
      // cut 없이 meme + 효과음 두 개만 있는, 배경이 없는 장면도 가능하다는 예시.
      text: '결론적으로 이 방법이 앞으로 표준이 될 수도 있다는 거.',
      duration: 3,
      blocks: [
        { type: 'meme', image: 'dancingpepe1.gif', startOffset: 0.3, duration: 2.5 },
        { type: 'sound', name: 'siu', startOffset: 0.3, duration: 1.5, volume: 0.3 },
      ],
    },
  ],
};

export interface ScriptStudioProps {
  // PdfPanel에서 Gemini로 생성한 대본. 들어오면 아래 JSON 에디터/프리뷰에 그대로 반영된다.
  externalScript?: ShortScript | null;
  // 업로드된 PDF 문서. cut 블록이 참조하는 페이지를 미리 렌더링해서 캐싱하는 데 쓴다.
  pdf?: PDFDocumentProxy | null;
}

/** JSON을 손으로 채워 Remotion 렌더링을 검증하는 화면. externalScript가 오면 그걸로 덮어쓴다. */
function ScriptStudio({ externalScript, pdf }: ScriptStudioProps) {
  const [jsonText, setJsonText] = useState(() => JSON.stringify(DUMMY_SCRIPT, null, 2));
  const [script, setScript] = useState<ShortScript>(DUMMY_SCRIPT);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // page 번호 -> 렌더링된 data URL. 재생 중(Sequence 마운트 시점)에 즉석으로 pdfjs를 돌리면
  // 그 렌더링이 메인 스레드를 잠깐 점유해서 나레이션 오디오 재생 시작과 경합 — 그러면 오디오 싱크가
  // 따라잡으려고 맨 앞부분을 건너뛰는 문제가 있었다. 그래서 재생 전에 미리 다 그려서 캐싱해둔다.
  const [pageImages, setPageImages] = useState<Record<number, string>>({});
  // externalScript가 바뀐 걸 렌더링 중에 감지해서 그 즉시 state를 맞춘다(리액트 공식 권장 패턴).
  // useEffect로 하면 한 프레임 구 대본으로 먼저 그렸다가 다시 렌더링하는 낭비가 생긴다.
  const [syncedExternalScript, setSyncedExternalScript] = useState(externalScript);

  if (externalScript && externalScript !== syncedExternalScript) {
    setSyncedExternalScript(externalScript);
    setJsonText(JSON.stringify(externalScript, null, 2));
    setScript(externalScript);
    setJsonError(null);
    setVersion((v) => v + 1);
  }

  // pdf 또는 script(가 참조하는 cut 페이지)가 바뀌면 필요한 페이지를 전부 미리 렌더링한다.
  // pdf가 없을 때는 아래 inputProps에서 그냥 빈 캐시를 쓰도록 유도만 하고, 여기서 state를
  // 리셋하려고 effect를 쓰지는 않는다(렌더링 중에 바로 파생 가능한 값이라 불필요한 리렌더 방지).
  useEffect(() => {
    if (!pdf) return;

    const pages = new Set<number>();
    for (const scene of script.scenes) {
      for (const block of scene.blocks) {
        if (block.type === 'cut') pages.add(block.page);
      }
    }

    let cancelled = false;

    Promise.all(
      Array.from(pages).map(async (pageNum): Promise<[number, string] | null> => {
        try {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const context = canvas.getContext('2d');
          if (!context) return null;

          await page.render({ canvas, canvasContext: context, viewport }).promise;
          return [pageNum, canvas.toDataURL('image/png')];
        } catch {
          // 페이지 번호가 실제 PDF 범위를 벗어나는 등 실패하면 그 페이지만 조용히 건너뛴다.
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const valid = entries.filter((e): e is [number, string] => e !== null);
      setPageImages(Object.fromEntries(valid));
    });

    return () => {
      cancelled = true;
    };
  }, [pdf, script]);

  function applyJson() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      setJsonError(err instanceof Error ? `JSON 파싱 실패: ${err.message}` : 'JSON 파싱 실패');
      return;
    }

    const result = shortScriptSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
      setJsonError(issues);
      return;
    }

    setScript(result.data);
    setJsonError(null);
    setVersion((v) => v + 1);
  }

  const inputProps = useMemo(
    () => ({ script, pageImages: pdf ? pageImages : {} }),
    [script, pageImages, pdf],
  );

  return (
    <div className="studio">
      <div className="script-editor">
        <h2>영상 대본 (JSON)</h2>
        <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false} />
        {jsonError && <p className="error" style={{ whiteSpace: 'pre-wrap' }}>{jsonError}</p>}
        <button type="button" onClick={applyJson}>
          적용
        </button>
      </div>

      <div className="video-preview">
        <Player
          key={version}
          component={ShortsVideo}
          inputProps={inputProps}
          durationInFrames={totalDurationInFrames(script.scenes, FPS)}
          fps={FPS}
          compositionWidth={WIDTH}
          compositionHeight={HEIGHT}
          style={{ width: '100%', maxWidth: 380, aspectRatio: `${WIDTH} / ${HEIGHT}` }}
          acknowledgeRemotionLicense
          controls
        />
      </div>
    </div>
  );
}

export default ScriptStudio;
