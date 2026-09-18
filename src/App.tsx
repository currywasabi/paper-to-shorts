import { useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import './App.css';
import PdfPanel from './components/PdfPanel';
import ScriptStudio from './components/ScriptStudio';
import type { ShortScript } from './schema';

function App() {
  // Gemini가 생성한 대본을 PdfPanel에서 ScriptStudio로 그대로 넘기기 위한 공유 state.
  const [generatedScript, setGeneratedScript] = useState<ShortScript | null>(null);
  // cut 블록이 실제 PDF 페이지를 렌더링할 수 있도록 로드된 문서도 함께 공유한다.
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <PdfPanel onScriptGenerated={setGeneratedScript} onPdfLoaded={setPdf} />
      </aside>
      <main className="main-panel">
        <ScriptStudio externalScript={generatedScript} pdf={pdf} />
      </main>
    </div>
  );
}

export default App;
