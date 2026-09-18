import { useState } from 'react';

import './App.css';
import PdfPanel from './components/PdfPanel';
import ScriptStudio from './components/ScriptStudio';
import type { ShortScript } from './schema';

function App() {
  // Gemini가 생성한 대본을 PdfPanel에서 ScriptStudio로 그대로 넘기기 위한 공유 state.
  const [generatedScript, setGeneratedScript] = useState<ShortScript | null>(null);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <PdfPanel onScriptGenerated={setGeneratedScript} />
      </aside>
      <main className="main-panel">
        <ScriptStudio externalScript={generatedScript} />
      </main>
    </div>
  );
}

export default App;
