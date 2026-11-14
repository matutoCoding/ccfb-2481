// 节点编辑页：左画布 / 右参数，顶部撤销重做与 GLSL 查看
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { NodeCanvas } from '../components/NodeCanvas';
import { GlazePanel, NodePalette, NodePropEditor } from '../components/NodePropEditor';
import { PreviewCanvas } from '../components/PreviewCanvas';
import { compileGraph } from '../nodes/compiler';
import type { NodeError } from '../types';
import type { Renderer } from '../webgl/renderer';

export function NodeEditorPage() {
  const { state, currentMaterial, dispatch, notify } = useStore();
  const [tab, setTab] = useState<'props' | 'palette' | 'glsl'>('props');
  const [showPreview, setShowPreview] = useState(true);
  const [driverErrors, setDriverErrors] = useState<NodeError[]>([]);
  const rendererRef = useRef<Renderer | null>(null);

  const selectedNode = currentMaterial?.graph.nodes.find((n) => n.id === state.selectedNodeId) ?? null;
  const compiled = useMemo(
    () => (currentMaterial ? compileGraph(currentMaterial.graph) : null),
    [currentMaterial],
  );

  // 监听 PreviewCanvas 上报的驱动编译错误，给对应节点画红框
  useEffect(() => {
    const onErr = (e: Event) => setDriverErrors((e as CustomEvent<NodeError[]>).detail ?? []);
    window.addEventListener('glaze:shader-errors', onErr);
    return () => window.removeEventListener('glaze:shader-errors', onErr);
  }, []);

  const errorNodes = useMemo(() => new Set(driverErrors.map((e) => e.nodeId).filter(Boolean) as string[]), [driverErrors]);

  if (!currentMaterial) {
    return <div className="page-body">没有可编辑的材质，请先到材质库新建。</div>;
  }

  return (
    <>
      <div className="page-header">
        <input
          className="mono"
          style={{ width: 220, fontWeight: 600 }}
          value={currentMaterial.name}
          onChange={(e) => dispatch({ type: 'rename-material', id: currentMaterial.id, name: e.target.value })}
        />
        <button
          className="btn small"
          disabled={state.past.length === 0}
          onClick={() => dispatch({ type: 'undo' })}
          title="Ctrl+Z"
        >↶ 撤销 ({state.past.length})</button>
        <button
          className="btn small"
          disabled={state.future.length === 0}
          onClick={() => dispatch({ type: 'redo' })}
          title="Ctrl+Y"
        >↷ 重做 ({state.future.length})</button>
        <button
          className="btn small"
          onClick={() => {
            if (!state.clipboard) { notify('剪贴板为空，先选中节点按 Ctrl+C'); return; }
            dispatch({ type: 'paste-nodes' });
          }}
        >粘贴节点 (Ctrl+V)</button>
        <div className="spacer" style={{ flex: 1 }} />
        <button className={`btn small ${showPreview ? 'active' : ''}`} onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? '隐藏' : '显示'}实时预览
        </button>
        <button className={`btn small ${tab === 'glsl' ? 'active' : ''}`} onClick={() => setTab(tab === 'glsl' ? 'props' : 'glsl')}>
          查看 GLSL
        </button>
      </div>

      <div className="editor-layout">
        <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
          <NodeCanvas errorNodes={errorNodes} />
          {showPreview && (
            <div style={{ width: 340, borderLeft: '1px solid var(--border)', position: 'relative' }}>
              <PreviewCanvas
                ref={rendererRef}
                height="100%"
                showEnvButton
                onRenderer={() => {
                  // 错误由 PreviewCanvas 内部面板展示；同时通过自定义事件广播节点 id
                }}
              />
            </div>
          )}
        </div>

        <div className="editor-side">
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
            {([['props', '参数'], ['palette', '节点库']] as const).map(([id, label]) => (
              <button
                key={id}
                className={`btn small ${tab === id ? 'active' : ''}`}
                style={{ flex: 1, borderRadius: 0, border: 'none' }}
                onClick={() => setTab(id)}
              >{label}</button>
            ))}
          </div>
          {tab === 'palette' && <NodePalette />}
          {tab === 'props' && (
            <>
              {selectedNode
                ? <NodePropEditor node={selectedNode} />
                : <div className="prop-panel muted">未选中节点，点击节点编辑参数</div>}
              <GlazePanel />
            </>
          )}
          {tab === 'glsl' && (
            <div className="scroll-y" style={{ padding: 12 }}>
              <div className="muted" style={{ marginBottom: 8 }}>
                {compiled?.ok ? `编译通过 · ${compiled.uniforms.length} 个 uniform` : '存在结构错误'}
              </div>
              <pre className="mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.55 }}>
                {compiled?.glsl ?? '// 无可用 GLSL'}
              </pre>
              <button
                className="btn small"
                style={{ marginTop: 10 }}
                onClick={() => {
                  navigator.clipboard.writeText(compiled?.glsl ?? '');
                  notify('GLSL 已复制到剪贴板');
                }}
              >复制 GLSL</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
