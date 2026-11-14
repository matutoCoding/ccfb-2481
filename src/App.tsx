import { useStore } from './state/store';
import type { PageId } from './types';
import { LibraryPage } from './pages/LibraryPage';
import { NodeEditorPage } from './pages/NodeEditorPage';
import { VesselPage } from './pages/VesselPage';
import { PreviewPage } from './pages/PreviewPage';
import { ExportPage } from './pages/ExportPage';

const NAV: { id: PageId; label: string; ico: string }[] = [
  { id: 'library', label: '材质库', ico: '🧪' },
  { id: 'editor', label: '节点编辑', ico: '🔗' },
  { id: 'vessel', label: '器型', ico: '🏺' },
  { id: 'preview', label: '渲染预览', ico: '✨' },
  { id: 'export', label: '导出', ico: '📤' },
];

export function App() {
  const { state, dispatch } = useStore();
  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="logo">
          釉面工坊
          <small>GLAZE STUDIO</small>
        </div>
        {NAV.map((n) => (
          <div
            key={n.id}
            className={`nav-item ${state.page === n.id ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'page', page: n.id })}
          >
            <span className="ico">{n.ico}</span>
            {n.label}
          </div>
        ))}
        <div className="footer">
          WebGL2 · GLSL ES 3.00<br />
          数据保存在本地浏览器
        </div>
      </nav>
      <main className="page">
        {state.page === 'library' && <LibraryPage />}
        {state.page === 'editor' && <NodeEditorPage />}
        {state.page === 'vessel' && <VesselPage />}
        {state.page === 'preview' && <PreviewPage />}
        {state.page === 'export' && <ExportPage />}
      </main>
      {state.toast && <div className="toast">{state.toast}</div>}
    </div>
  );
}
