import { useEffect, useRef, useState } from 'react';
import { Player } from '@remotion/player';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import type { Channel } from '../lib/channels';
import { MAX_FILE_SIZE, validatePdfFile } from '../lib/pdfFile';
import { saveVideo } from '../lib/saveVideo';
import { summarizeScript } from '../lib/summarizeScript';
import { totalDurationInFrames } from '../remotion/layout';
import { ShortsVideo } from '../remotion/ShortsVideo';
import type { ShortScript } from '../schema';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

// summarize-script는 한 요청 안에서 PDF 업로드 → Gemini 분석 → 씬별 TTS 합성을 순서대로 처리한다.
// 서버가 중간 진행 상황을 스트리밍해주진 않으니, 각 단계가 보통 걸리는 시간을 기준으로 대략 흉내만 낸다.
const SUMMARIZE_STAGES = [
  { afterMs: 0, label: 'PDF를 Gemini에 업로드하는 중...' },
  { afterMs: 3_000, label: 'Gemini가 대본을 작성하는 중... (20초 안팎)' },
  { afterMs: 23_000, label: 'Typecast로 나레이션 음성 합성 중... (동시 2개씩 순차 처리)' },
] as const;

type Stage = 'idle' | 'summarizing' | 'ready' | 'saving';

export interface AddVideoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: Channel[];
  // 갤러리에서 보고 있던 채널. null이면 "전체" — 저장할 채널을 따로 골라야 한다.
  contextChannelId: string | null;
  onSaved: () => void;
}

/** cut 블록이 참조하는 페이지들을 미리 렌더링해서 캐싱한다 — 재생 중 즉석 렌더링은
 * 나레이션 오디오 재생 시작과 경합해서 뺐다(ScriptStudio에서 쓰던 방식 그대로). */
async function renderCutPages(pdf: PDFDocumentProxy, script: ShortScript): Promise<Record<number, string>> {
  const pages = new Set<number>();
  for (const scene of script.scenes) {
    for (const block of scene.blocks) {
      if (block.type === 'cut') pages.add(block.page);
    }
  }

  const entries = await Promise.all(
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
        return null;
      }
    }),
  );

  return Object.fromEntries(entries.filter((e): e is [number, string] => e !== null));
}

/** PDF 업로드 → (로딩만 보여주며) 대본+나레이션 생성 → 미리보기 → 채널 저장까지의 전체 흐름.
 * 생성 중간 결과(JSON)는 사용자에게 보여주지 않는다 — 편집 도구는 없고, 결과 미리보기와 저장/취소만 있다. */
function AddVideoModal({ open, onOpenChange, channels, contextChannelId, onSaved }: AddVideoModalProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [summarizeStage, setSummarizeStage] = useState<string | null>(null);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [script, setScript] = useState<ShortScript | null>(null);
  const [pageImages, setPageImages] = useState<Record<number, string>>({});
  const [targetChannelId, setTargetChannelId] = useState<string>('');

  const inputRef = useRef<HTMLInputElement>(null);

  // 모달을 다시 열 때마다 깨끗한 상태로 시작한다.
  useEffect(() => {
    if (!open) return;
    setStage('idle');
    setDragging(false);
    setFileError(null);
    setSummarizeStage(null);
    setSummarizeError(null);
    setSaveError(null);
    setScript(null);
    setPageImages({});
    setTargetChannelId(contextChannelId ?? channels[0]?.id ?? '');
  }, [open, contextChannelId, channels]);

  async function handleFile(file: File | null) {
    if (!file) return;

    const validationError = await validatePdfFile(file);
    if (validationError) {
      setFileError(validationError);
      return;
    }
    setFileError(null);

    setStage('summarizing');
    setSummarizeStage(SUMMARIZE_STAGES[0].label);
    const timers = SUMMARIZE_STAGES.slice(1).map(({ afterMs, label }) =>
      setTimeout(() => setSummarizeStage(label), afterMs),
    );

    try {
      const [pdf, generated] = await Promise.all([
        file.arrayBuffer().then((buffer) => pdfjsLib.getDocument({ data: buffer }).promise),
        summarizeScript(file),
      ]);
      const images = await renderCutPages(pdf, generated);
      setPageImages(images);
      setScript(generated);
      setStage('ready');
    } catch (err) {
      setSummarizeError(err instanceof Error ? err.message : '대본 생성 중 오류가 발생했습니다.');
      setStage('idle');
    } finally {
      timers.forEach(clearTimeout);
      setSummarizeStage(null);
    }
  }

  function onDrop(e: React.DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0] ?? null);
  }

  async function handleSave() {
    if (!script || !targetChannelId) return;

    setStage('saving');
    setSaveError(null);
    try {
      await saveVideo({ channelId: targetChannelId, script, pageImages });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.');
      setStage('ready');
    }
  }

  const inputProps = script ? { script, pageImages } : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>동영상 추가</DialogTitle>
          <DialogDescription>PDF를 업로드하면 쇼츠 대본과 나레이션을 자동으로 만듭니다.</DialogDescription>
        </DialogHeader>

        {(stage === 'idle' || stage === 'summarizing') && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              disabled={stage === 'summarizing'}
              className={`rounded-xl border-2 border-dashed p-10 text-center text-sm text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary hover:bg-primary/5'
              }`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              {stage === 'summarizing' ? (
                <span className="text-xs font-medium tracking-wide text-primary uppercase">
                  {summarizeStage ?? '생성 중...'}
                </span>
              ) : (
                <>
                  PDF 파일을 드래그하거나 클릭해서 업로드하세요
                  <br />
                  (최대 {MAX_FILE_SIZE / 1024 / 1024}MB)
                </>
              )}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            {fileError && <p className="text-sm text-destructive">{fileError}</p>}
            {summarizeError && <p className="text-sm text-destructive">{summarizeError}</p>}
          </div>
        )}

        {(stage === 'ready' || stage === 'saving') && script && inputProps && (
          <div className="flex flex-col gap-4">
            <p className="font-heading text-sm font-semibold text-foreground">{script.title}</p>

            <div className="flex justify-center rounded-2xl border border-border bg-card p-3 shadow-sm">
              <Player
                component={ShortsVideo}
                inputProps={inputProps}
                durationInFrames={totalDurationInFrames(script.scenes, FPS)}
                fps={FPS}
                compositionWidth={WIDTH}
                compositionHeight={HEIGHT}
                style={{ width: '100%', maxWidth: 220, aspectRatio: `${WIDTH} / ${HEIGHT}` }}
                acknowledgeRemotionLicense
                controls
              />
            </div>

            {contextChannelId ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {channels.find((c) => c.id === contextChannelId)?.name ?? '이 채널'}
                </span>
                에 저장됩니다.
              </p>
            ) : channels.length > 0 ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  저장할 채널
                </span>
                <select
                  value={targetChannelId}
                  onChange={(e) => setTargetChannelId(e.target.value)}
                  className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-sm text-destructive">
                채널이 없습니다. 사이드바에서 채널을 먼저 만들어주세요.
              </p>
            )}

            {saveError && <p className="text-sm text-destructive">{saveError}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setStage('idle')} disabled={stage === 'saving'}>
                다시 만들기
              </Button>
              <Button type="button" onClick={handleSave} disabled={stage === 'saving' || !targetChannelId}>
                {stage === 'saving' ? '저장 중...' : '채널에 저장'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default AddVideoModal;
