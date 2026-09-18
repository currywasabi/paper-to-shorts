import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import { MAX_FILE_SIZE, validatePdfFile } from '../lib/pdfFile';
import { summarizeScript } from '../lib/summarizeScript';
import type { ShortScript } from '../schema';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// summarize-script는 한 요청 안에서 PDF 업로드 → Gemini 분석 → 씬별 TTS 합성을 순서대로 처리한다.
// 서버가 중간 진행 상황을 스트리밍해주진 않으니, 각 단계가 보통 걸리는 시간을 기준으로 대략 흉내만 낸다.
const SUMMARIZE_STAGES = [
  { afterMs: 0, label: 'PDF를 Gemini에 업로드하는 중...' },
  { afterMs: 3_000, label: 'Gemini가 대본을 작성하는 중... (20초 안팎)' },
  { afterMs: 23_000, label: 'Typecast로 나레이션 음성 합성 중... (동시 2개씩 순차 처리)' },
] as const;

export interface PdfPanelProps {
  // 대본 생성이 끝나면 원본 JSON을 그대로 넘긴다 — ScriptStudio가 이걸로 에디터/프리뷰를 채운다.
  onScriptGenerated?: (script: ShortScript) => void;
}

/** PDF 업로드 → 뷰어 → 쇼츠 대본 생성. 기존 기능 그대로, 위치만 사이드바로 이동. */
function PdfPanel({ onScriptGenerated }: PdfPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);

  const [summarizing, setSummarizing] = useState(false);
  const [summarizeStage, setSummarizeStage] = useState<string | null>(null);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);
  const [generatedScript, setGeneratedScript] = useState<ShortScript | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  async function handleFile(next: File | null) {
    if (!next) return;

    const validationError = await validatePdfFile(next);
    if (validationError) {
      setError(validationError);
      setFile(null);
      setPdf(null);
      return;
    }

    setError(null);
    setFile(next);
    setPdf(null);
    setPageNum(1);
  }

  function reset() {
    setFile(null);
    setPdf(null);
    setError(null);
    setPageNum(1);
    setSummarizeError(null);
    setSummarizeStage(null);
    setGeneratedScript(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleSummarize() {
    if (!file) return;

    setSummarizing(true);
    setSummarizeError(null);
    setGeneratedScript(null);
    setSummarizeStage(SUMMARIZE_STAGES[0].label);

    const timers = SUMMARIZE_STAGES.slice(1).map(({ afterMs, label }) =>
      setTimeout(() => setSummarizeStage(label), afterMs),
    );

    try {
      const result = await summarizeScript(file);
      setGeneratedScript(result);
      onScriptGenerated?.(result);
    } catch (err) {
      setSummarizeError(err instanceof Error ? err.message : '대본 생성 중 오류가 발생했습니다.');
    } finally {
      timers.forEach(clearTimeout);
      setSummarizing(false);
      setSummarizeStage(null);
    }
  }

  // 파일이 바뀌면 pdfjs로 로드
  useEffect(() => {
    if (!file) return;

    let cancelled = false;

    file
      .arrayBuffer()
      .then((buffer) => pdfjsLib.getDocument({ data: buffer }).promise)
      .then((doc) => {
        if (!cancelled) setPdf(doc);
      })
      .catch(() => {
        if (!cancelled) setError('PDF 파일을 여는 중 문제가 발생했습니다.');
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  // pdf 또는 페이지가 바뀌면 캔버스에 렌더링
  useEffect(() => {
    if (!pdf || !canvasRef.current) return;

    let cancelled = false;

    pdf.getPage(pageNum).then(async (page) => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const viewport = page.getViewport({ scale: 1.5 });
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvas, canvasContext: context, viewport }).promise;
    });

    return () => {
      cancelled = true;
    };
  }, [pdf, pageNum]);

  function onDrop(e: React.DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0] ?? null);
  }

  if (!file) {
    return (
      <div className="app">
        <h1>PDF 업로드</h1>
        <button
          type="button"
          className={`dropzone${dragging ? ' dragging' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          PDF 파일을 드래그하거나 클릭해서 업로드하세요
          <br />
          (최대 {MAX_FILE_SIZE / 1024 / 1024}MB)
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          hidden
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="app">
      <div className="file-info">
        <span>{file.name}</span>
        <button type="button" onClick={reset}>
          다른 파일 선택
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="viewer">
        <canvas ref={canvasRef} />
        {pdf && (
          <div className="viewer-controls">
            <button
              type="button"
              disabled={pageNum <= 1}
              onClick={() => setPageNum((p) => p - 1)}
            >
              이전
            </button>
            <span>
              {pageNum} / {pdf.numPages}
            </span>
            <button
              type="button"
              disabled={pageNum >= pdf.numPages}
              onClick={() => setPageNum((p) => p + 1)}
            >
              다음
            </button>
          </div>
        )}
      </div>

      {pdf && (
        <div className="extract">
          <button type="button" onClick={handleSummarize} disabled={summarizing}>
            {summarizing ? '생성 중...' : '쇼츠 대본 생성'}
          </button>

          {summarizing && summarizeStage && <p className="scene-duration">{summarizeStage}</p>}

          {summarizeError && <p className="error">{summarizeError}</p>}

          {generatedScript && (
            <p className="scene-duration">
              ✅ "{generatedScript.title}" ·{' '}
              {generatedScript.scenes.reduce((sum, s) => sum + s.duration, 0).toFixed(1)}초 ·{' '}
              {generatedScript.scenes.length}개 장면 — 오른쪽 대본 화면에 반영됨
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default PdfPanel;
