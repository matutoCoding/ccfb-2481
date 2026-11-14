import { useRef } from 'react';
import { useStore, parseBundle } from '../state/store';
import { downloadText } from '../state/storage';
import { PreviewCanvas } from '../components/PreviewCanvas';
import type { Renderer } from '../webgl/renderer';

export function LibraryPage() {
  const { state, dispatch, currentMaterial, exportJSON, notify } = useStore();
  const rendererRef = useRef<Renderer | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveThumbnail = () => {
    const r = rendererRef.current;
    if (!r || !currentMaterial) return;
    r.present();
    const canvas = r.canvas;
    const thumb = canvas.toDataURL('image/jpeg', 0.72);
    dispatch({ type: 'set-thumbnail', id: currentMaterial.id, thumbnail: thumb });
    notify('缩略图已更新');
  };

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const bundle = parseBundle(text);
      dispatch({ type: 'import-bundle', bundle, merge: true });
      notify(`已导入 ${bundle.materials.length} 个材质、${bundle.vessels.length} 个器型`);
    } catch (e) {
      notify('导入失败：' + (e as Error).message);
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>材质库</h2>
        <span className="sub">共 {state.materials.length} 个釉色材质，保存在浏览器本地</span>
      </div>
      <div className="page-body">
        <div className="toolbar-row">
          <button className="btn primary" onClick={() => dispatch({ type: 'create-material' })}>＋ 新建材质</button>
          <button className="btn" onClick={() => downloadText(
            `glaze-bundle-${new Date().toISOString().slice(0, 10)}.glazebundle.json`, exportJSON())}>
            打包导出（发同事）
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>导入材质包</button>
          <input
            ref={fileRef} type="file" accept=".json,application/json" hidden
            onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
          />
          <div className="spacer" />
          {currentMaterial && (
            <button className="btn" onClick={saveThumbnail}>📸 用当前预览更新缩略图</button>
          )}
        </div>

        <div className="mat-grid">
          {state.materials.map((m) => (
            <div
              key={m.id}
              className={`mat-card ${m.id === state.currentMaterialId ? 'selected' : ''}`}
              onClick={() => dispatch({ type: 'select-material', id: m.id })}
              onDoubleClick={() => dispatch({ type: 'page', page: 'editor' })}
            >
              <div className="mat-thumb">
                {m.thumbnail
                  ? <img src={m.thumbnail} alt={m.name} />
                  : <span>🏺</span>}
              </div>
              <div className="mat-meta">
                <div className="name" title={m.name}>{m.name}</div>
                <div className="time">更新于 {new Date(m.updatedAt).toLocaleString('zh-CN', { hour12: false })}</div>
              </div>
              <div className="mat-actions">
                <button
                  className="btn small"
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: 'duplicate-material', id: m.id }); }}
                >复制</button>
                <button
                  className="btn small danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (state.materials.length <= 1) { notify('至少保留一个材质'); return; }
                    if (confirm(`确定删除「${m.name}」？`)) dispatch({ type: 'delete-material', id: m.id });
                  }}
                >删除</button>
              </div>
            </div>
          ))}
        </div>

        {currentMaterial && (
          <div style={{ marginTop: 26, height: 320, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <PreviewCanvas ref={rendererRef} showEnvButton={false} height={320} />
          </div>
        )}
      </div>
    </>
  );
}
