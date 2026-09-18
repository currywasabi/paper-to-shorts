import './App.css';
import PdfPanel from './components/PdfPanel';
import ScriptStudio from './components/ScriptStudio';

function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <PdfPanel />
      </aside>
      <main className="main-panel">
        <ScriptStudio />
      </main>
    </div>
  );
}

export default App;
