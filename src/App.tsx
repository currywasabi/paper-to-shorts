import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import './App.css';
import { MAX_FILE_SIZE, validatePdfFile } from './lib/pdfFile';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);

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
    if (inputRef.current) inputRef.current.value = '';
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
    </div>
  );
}

export default App;
