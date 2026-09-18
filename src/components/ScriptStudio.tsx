import { useMemo, useState } from 'react';
import { Player } from '@remotion/player';

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

/** JSON을 손으로 채워 Remotion 렌더링만 먼저 검증하기 위한 임시 화면. AI 연동은 아직 안 함. */
function ScriptStudio() {
  const [jsonText, setJsonText] = useState(() => JSON.stringify(DUMMY_SCRIPT, null, 2));
  const [script, setScript] = useState<ShortScript>(DUMMY_SCRIPT);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

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

  const inputProps = useMemo(() => ({ script }), [script]);

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
