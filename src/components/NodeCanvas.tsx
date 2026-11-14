// 节点编辑器画布：平移缩放、节点拖拽、端口连线、错误高亮
import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { useStore } from '../state/store';
import { getNodeDef, portTypeOf } from '../nodes/defs';
import { createNode } from '../state/defaults';
import { validateGraph } from '../nodes/compiler';
import type { GraphNode, MaterialGraph, NodeError, PortDef } from '../types';

interface ViewTransform { x: number; y: number; scale: number; }

interface DragState {
  kind: 'pan' | 'node' | 'connect';
  startX: number;
  startY: number;
  nodeId?: string;
  nodeOrigin?: { x: number; y: number };
  viewOrigin?: ViewTransform;
  fromNode?: string;
  fromPort?: PortDef;
  mouse?: { x: number; y: number };
}

const NODE_W = 168;
const HEADER_H = 31;
const ROW_H = 20;

function portScreenPos(node: GraphNode, portId: string, kind: 'in' | 'out', view: ViewTransform) {
  const def = getNodeDef(node.type)!;
  const ports = kind === 'in' ? def.inputs : def.outputs;
  const idx = ports.findIndex((p) => p.id === portId);
  const x = node.pos.x + (kind === 'in' ? -6 : NODE_W + 6);
  const y = node.pos.y + HEADER_H + 8 + idx * ROW_H + 5;
  return { x: x * view.scale + view.x, y: y * view.scale + view.y };
}

export function NodeCanvas({ errorNodes }: { errorNodes: Set<string> }) {
  const { state, currentMaterial, commitGraph, dispatch, notify } = useStore();
  const graph = currentMaterial?.graph;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewTransform>({ x: 40, y: 30, scale: 1 });
  const dragRef = useRef<DragState | null>(null);
  const [, forceTick] = useState(0);
  const [hoverPort, setHoverPort] = useState<{ nodeId: string; portId: string } | null>(null);

  const graphErrors: NodeError[] = useMemo(
    () => (graph ? validateGraph(graph) : []),
    [graph],
  );
  const structuralErrorNodes = useMemo(
    () => new Set(graphErrors.map((e) => e.nodeId).filter(Boolean) as string[]),
    [graphErrors],
  );

  const updateGraph = useCallback((mutate: (g: MaterialGraph) => MaterialGraph) => {
    if (!graph) return;
    commitGraph(mutate(JSON.parse(JSON.stringify(graph))));
  }, [graph, commitGraph]);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    };
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.graph-node')) return;
    dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, viewOrigin: { ...view } };
    dispatch({ type: 'select-node', id: null });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onNodeDown = (e: React.PointerEvent, node: GraphNode) => {
    e.stopPropagation();
    dispatch({ type: 'select-node', id: node.id });
    dragRef.current = {
      kind: 'node', startX: e.clientX, startY: e.clientY,
      nodeId: node.id, nodeOrigin: { ...node.pos },
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPortDown = (e: React.PointerEvent, node: GraphNode, port: PortDef, kind: 'in' | 'out') => {
    e.stopPropagation();
    if (kind === 'in' && node.inputs[port.id]) {
      // 点击已连接的输入端口：断开
      updateGraph((g) => {
        const n = g.nodes.find((x) => x.id === node.id)!;
        delete n.inputs[port.id];
        return g;
      });
      notify(`已断开「${getNodeDef(node.type)?.label}.${port.name}」`);
      return;
    }
    dragRef.current = {
      kind: 'connect', startX: e.clientX, startY: e.clientY,
      fromNode: kind === 'out' ? node.id : node.id,
      fromPort: port,
      mouse: { x: e.clientX, y: e.clientY },
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pan' && d.viewOrigin) {
      setView({
        ...d.viewOrigin,
        x: d.viewOrigin.x + (e.clientX - d.startX),
        y: d.viewOrigin.y + (e.clientY - d.startY),
      });
    } else if (d.kind === 'node' && d.nodeId && d.nodeOrigin) {
      const w = toWorld(e.clientX, e.clientY);
      const w0 = toWorld(d.startX, d.startY);
      updateGraph((g) => {
        const n = g.nodes.find((x) => x.id === d.nodeId);
        if (n) n.pos = { x: d.nodeOrigin!.x + (w.x - w0.x), y: d.nodeOrigin!.y + (w.y - w0.y) };
        return g;
      });
    } else if (d.kind === 'connect') {
      d.mouse = { x: e.clientX, y: e.clientY };
      forceTick((t) => t + 1);
    }
  };

  const tryConnect = (targetNodeId: string, targetPort: PortDef) => {
    const d = dragRef.current;
    if (!d || d.kind !== 'connect' || !d.fromNode || !d.fromPort) return;
    const srcNode = graph!.nodes.find((n) => n.id === d.fromNode)!;
    const dstNode = graph!.nodes.find((n) => n.id === targetNodeId)!;
    const srcDef = getNodeDef(srcNode.type)!;
    const dstDef = getNodeDef(dstNode.type)!;
    const srcIsOut = srcDef.outputs.some((p) => p.id === d.fromPort!.id);
    let srcId = srcIsOut ? d.fromNode! : targetNodeId;
    let srcPort = srcIsOut ? d.fromPort! : targetPort;
    let dstId = srcIsOut ? targetNodeId : d.fromNode!;
    let dstPort = srcIsOut ? targetPort : d.fromPort!;

    if (srcId === dstId) { notify('不能连接节点自身'); return; }
    const srcType = portTypeOf(getNodeDef(graph!.nodes.find((n) => n.id === srcId)!.type)!, srcPort.id, 'out');
    const dstType = portTypeOf(getNodeDef(graph!.nodes.find((n) => n.id === dstId)!.type)!, dstPort.id, 'in');
    if (!srcType || !dstType) { notify('端口不存在'); return; }
    if (srcType !== dstType) {
      notify(`连不上：${srcType} 类型不能接到需要 ${dstType} 的「${dstDef.label}.${dstPort.name}」`);
      return;
    }
    updateGraph((g) => {
      const n = g.nodes.find((x) => x.id === dstId)!;
      n.inputs[dstPort.id] = { node: srcId, port: srcPort.id };
      return g;
    });
  };

  const onUp = () => {
    // 兜底：若在输入端口附近松开但端口的 onPointerUp 未触发，用 hover 状态补一次
    const d = dragRef.current;
    if (d?.kind === 'connect' && hoverPort) {
      const targetNode = graph?.nodes.find((n) => n.id === hoverPort.nodeId);
      const targetDef = targetNode && getNodeDef(targetNode.type);
      const targetPort = targetDef?.inputs.find((p) => p.id === hoverPort.portId);
      if (targetNode && targetPort) tryConnect(targetNode.id, targetPort);
    }
    dragRef.current = null;
    setHoverPort(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const scale = Math.max(0.4, Math.min(2.2, view.scale * factor));
    setView({
      scale,
      x: mx - ((mx - view.x) / view.scale) * scale,
      y: my - ((my - view.y) / view.scale) * scale,
    });
  };

  // 从调色板拖入新建
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('node-type');
    if (!type || !graph) return;
    const def = getNodeDef(type);
    if (!def) return;
    if (def.singleton && graph.nodes.some((n) => n.type === type)) {
      notify(`「${def.label}」只能存在一个`);
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    const node = createNode(type, w.x - NODE_W / 2, w.y - 12);
    updateGraph((g) => ({ nodes: [...g.nodes, node] }));
    dispatch({ type: 'select-node', id: node.id });
  };

  // 快捷键：删除选中节点、复制粘贴、撤销重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'undo' }); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault(); dispatch({ type: 'redo' });
      } else if (mod && e.key.toLowerCase() === 'c' && state.selectedNodeId) {
        const n = graph?.nodes.find((x) => x.id === state.selectedNodeId);
        if (n) { dispatch({ type: 'copy-nodes', nodes: [n] }); notify('已复制节点'); }
      } else if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        dispatch({ type: 'paste-nodes' });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedNodeId) {
        const id = state.selectedNodeId;
        const node = graph?.nodes.find((n) => n.id === id);
        if (node?.type === 'output') { notify('材质输出节点不能删除'); return; }
        updateGraph((g) => ({
          nodes: g.nodes
            .filter((n) => n.id !== id)
            .map((n) => {
              for (const [port, ref] of Object.entries(n.inputs)) {
                if (ref.node === id) delete n.inputs[port];
              }
              return n;
            }),
        }));
        dispatch({ type: 'select-node', id: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [graph, state.selectedNodeId, dispatch, updateGraph, notify]);

  if (!graph) return null;

  const edges: { id: string; d: string; active: boolean }[] = [];
  for (const node of graph.nodes) {
    for (const [portId, ref] of Object.entries(node.inputs)) {
      const src = graph.nodes.find((n) => n.id === ref.node);
      if (!src) continue;
      const a = portScreenPos(src, ref.port, 'out', view);
      const b = portScreenPos(node, portId, 'in', view);
      const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
      edges.push({
        id: `${ref.node}.${ref.port}->${node.id}.${portId}`,
        d: `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`,
        active: state.selectedNodeId === node.id || state.selectedNodeId === ref.node,
      });
    }
  }

  const tempLine = (() => {
    const d = dragRef.current;
    if (d?.kind !== 'connect' || !d.fromNode || !d.fromPort || !d.mouse) return null;
    const srcNode = graph.nodes.find((n) => n.id === d.fromNode)!;
    const srcDef = getNodeDef(srcNode.type)!;
    const isOut = srcDef.outputs.some((p) => p.id === d.fromPort!.id);
    const a = portScreenPos(srcNode, d.fromPort.id, isOut ? 'out' : 'in', view);
    const b = d.mouse;
    const dx = 60;
    return isOut
      ? `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
      : `M ${b.x} ${b.y} C ${b.x + dx} ${b.y}, ${a.x - dx} ${a.y}, ${a.x} ${a.y}`;
  })();

  return (
    <div
      ref={wrapRef}
      className="editor-canvas-wrap"
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onWheel={onWheel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <svg className="edge-svg">
        {edges.map((e) => (
          <path key={e.id} className={`edge-path ${e.active ? 'active' : ''}`} d={e.d} />
        ))}
        {tempLine && <path className="edge-path temp" d={tempLine} />}
      </svg>

      {graph.nodes.map((node) => {
        const def = getNodeDef(node.type);
        if (!def) return null;
        const isErr = structuralErrorNodes.has(node.id) || errorNodes.has(node.id);
        return (
          <div
            key={node.id}
            className={`graph-node ${state.selectedNodeId === node.id ? 'selected' : ''} ${isErr ? 'error' : ''}`}
            style={{
              left: node.pos.x * view.scale + view.x,
              top: node.pos.y * view.scale + view.y,
              width: NODE_W * view.scale,
              transform: `scale(${view.scale})`,
              transformOrigin: 'top left',
            }}
            onPointerDown={(e) => onNodeDown(e, node)}
          >
            <div className="gn-title">
              <span>{def.label}</span>
              {isErr && <span title="该节点有错误" style={{ color: 'var(--danger)' }}>⚠</span>}
            </div>
            <div className="gn-body">
              {def.inputs.map((p) => (
                <div className="port-row" key={`in-${p.id}`}>
                  <span
                    className={`port-dot in ${p.type} ${hoverPort?.nodeId === node.id && hoverPort.portId === p.id ? 'connecting' : ''}`}
                    onPointerDown={(e) => onPortDown(e, node, p, 'in')}
                    onPointerUp={() => tryConnect(node.id, p)}
                    onPointerEnter={() => setHoverPort({ nodeId: node.id, portId: p.id })}
                    onPointerLeave={() => setHoverPort(null)}
                  />
                  <span title={node.inputs[p.id] ? '点击断开连接' : p.name}>{p.name}</span>
                </div>
              ))}
              {def.outputs.map((p) => (
                <div className="port-row out" key={`out-${p.id}`}>
                  <span>{p.name}</span>
                  <span
                    className={`port-dot out ${p.type}`}
                    onPointerDown={(e) => onPortDown(e, node, p, 'out')}
                    onPointerUp={() => {
                      if (hoverPort) tryConnect(hoverPort.nodeId, getNodeDef(graph.nodes.find((n) => n.id === hoverPort.nodeId)!.type)!.inputs.find((x) => x.id === hoverPort.portId)!);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {graphErrors.length > 0 && (
        <div className="shader-error-panel" style={{ maxWidth: 420 }}>
          <div className="shader-error-title">连线问题（{graphErrors.length}）</div>
          {graphErrors.slice(0, 4).map((e, i) => (
            <div key={i} className="shader-error-item">
              ⛳ {e.nodeId ? `「${getNodeDef(graph.nodes.find((n) => n.id === e.nodeId)?.type ?? '')?.label ?? '节点'}」：` : ''}
              {e.message}
            </div>
          ))}
        </div>
      )}

      <div className="preview-hint">
        缩放 {(view.scale * 100).toFixed(0)}% · 拖左侧节点到此处新建 · 端口拖动连线 · 点输入端口断开
      </div>
      <div style={{ position: 'absolute', right: 12, bottom: 10, display: 'flex', gap: 6 }}>
        <button className="btn small" onClick={() => setView({ x: 40, y: 30, scale: 1 })}>复位视图</button>
      </div>
    </div>
  );
}
