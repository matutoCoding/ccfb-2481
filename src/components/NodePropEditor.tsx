// 节点参数编辑面板 + 釉层物理参数 + 节点调色板
import { useStore } from '../state/store';
import { NODE_DEFS, getNodeDef } from '../nodes/defs';
import type { GraphNode, ParamValue } from '../types';

function NumberInput({ value, onChange, min, max, step }: {
  value: number;
  onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
}) {
  return (
    <div className="row">
      <input
        type="range"
        min={min} max={max} step={step ?? 0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <input
        type="number"
        style={{ width: 64 }}
        min={min} max={max} step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

function ColorInput({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const toHex = (c: number[]) => '#' + c.map((x) =>
    Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('');
  const fromHex = (hex: string): number[] => {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  return (
    <div className="color-row">
      <input type="color" value={toHex(value)} onChange={(e) => onChange(fromHex(e.target.value))} />
      {value.map((c, i) => (
        <input
          key={i} type="number" min={0} max={1} step={0.01} value={c.toFixed(2)}
          onChange={(e) => {
            const next = [...value];
            next[i] = parseFloat(e.target.value);
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

function Vector2Input({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="color-row">
      {value.map((c, i) => (
        <input
          key={i} type="number" step={0.05} value={c}
          onChange={(e) => {
            const next = [...value];
            next[i] = parseFloat(e.target.value);
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

function RampEditor({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const stops: { pos: number; rgb: number[] }[] = [];
  for (let i = 0; i + 3 < value.length; i += 4) {
    stops.push({ pos: value[i], rgb: [value[i + 1], value[i + 2], value[i + 3]] });
  }
  const css = stops
    .slice()
    .sort((a, b) => a.pos - b.pos)
    .map((s) => {
      const c = s.rgb.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255));
      return `rgb(${c[0]},${c[1]},${c[2]}) ${(s.pos * 100).toFixed(1)}%`;
    })
    .join(', ');

  const update = (idx: number, patch: Partial<{ pos: number; rgb: number[] }>) => {
    const next = [...value];
    if (patch.pos !== undefined) next[idx * 4] = patch.pos;
    if (patch.rgb) {
      next[idx * 4 + 1] = patch.rgb[0];
      next[idx * 4 + 2] = patch.rgb[1];
      next[idx * 4 + 3] = patch.rgb[2];
    }
    onChange(next);
  };

  return (
    <div className="ramp-editor">
      <div className="ramp-bar" style={{ background: `linear-gradient(90deg, ${css})` }} />
      {stops.map((s, i) => (
        <div className="ramp-stop-row" key={i}>
          <input
            type="number" min={0} max={1} step={0.01} value={s.pos.toFixed(2)}
            onChange={(e) => update(i, { pos: parseFloat(e.target.value) })}
          />
          <input
            type="color"
            value={'#' + s.rgb.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('')}
            onChange={(e) => {
              const n = parseInt(e.target.value.slice(1), 16);
              update(i, { rgb: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] });
            }}
          />
          {i > 1 && (
            <button
              className="btn small danger"
              onClick={() => onChange(value.filter((_, k) => k < i * 4 || k >= i * 4 + 4))}
            >删</button>
          )}
        </div>
      ))}
      {stops.length < 8 && (
        <button
          className="btn small"
          onClick={() => onChange([...value, 0.5, 0.5, 0.5, 0.5])}
        >＋ 添加色标</button>
      )}
    </div>
  );
}

export function NodePropEditor({ node }: { node: GraphNode }) {
  const { commitGraph, currentMaterial } = useStore();
  const def = getNodeDef(node.type);
  if (!def) return null;

  const setParam = (paramId: string, v: ParamValue) => {
    if (!currentMaterial) return;
    const graph: typeof currentMaterial.graph = JSON.parse(JSON.stringify(currentMaterial.graph));
    const n = graph.nodes.find((x) => x.id === node.id);
    if (n) {
      n.params[paramId] = v;
      commitGraph(graph);
    }
  };

  return (
    <div className="prop-panel">
      <h4>{def.label} · 参数</h4>
      {def.params.length === 0 && <p className="muted">该节点没有可调参数</p>}
      {def.params.map((p) => (
        <div className="prop-group" key={p.id}>
          <label>{p.name}</label>
          {p.kind === 'number' && (
            <NumberInput
              value={node.params[p.id] as number ?? p.default as number}
              min={p.min} max={p.max} step={p.step}
              onChange={(v) => setParam(p.id, v)}
            />
          )}
          {p.kind === 'color' && (
            <ColorInput value={(node.params[p.id] as number[]) ?? (p.default as number[])} onChange={(v) => setParam(p.id, v)} />
          )}
          {p.kind === 'vector2' && (
            <Vector2Input value={(node.params[p.id] as number[]) ?? (p.default as number[])} onChange={(v) => setParam(p.id, v)} />
          )}
          {p.kind === 'select' && (
            <select value={node.params[p.id] as string} onChange={(e) => setParam(p.id, e.target.value)}>
              {p.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {p.kind === 'ramp' && (
            <RampEditor value={(node.params[p.id] as number[]) ?? (p.default as number[])} onChange={(v) => setParam(p.id, v)} />
          )}
        </div>
      ))}
    </div>
  );
}

export function GlazePanel() {
  const { currentMaterial, dispatch } = useStore();
  if (!currentMaterial) return null;
  const g = currentMaterial.glaze;
  const set = (patch: Partial<typeof g>) => dispatch({ type: 'patch-glaze', patch });

  return (
    <div className="prop-panel" style={{ borderTop: '1px solid var(--border)' }}>
      <h4>釉层物理参数</h4>
      <div className="prop-group">
        <label>胎体颜色</label>
        <ColorInput value={g.bodyColor} onChange={(v) => set({ bodyColor: v as [number, number, number] })} />
      </div>
      <div className="prop-group">
        <label>釉层厚度 ×{g.thicknessScale.toFixed(2)}</label>
        <NumberInput value={g.thicknessScale} min={0.1} max={3} step={0.05} onChange={(v) => set({ thicknessScale: v })} />
      </div>
      <div className="prop-group">
        <label>吸收系数（釉厚处颜色加深）{g.absorption.toFixed(2)}</label>
        <NumberInput value={g.absorption} min={0} max={3} step={0.05} onChange={(v) => set({ absorption: v })} />
      </div>
      <div className="prop-group">
        <label>折射率 IOR {g.ior.toFixed(2)}</label>
        <NumberInput value={g.ior} min={1.0} max={2.2} step={0.01} onChange={(v) => set({ ior: v })} />
      </div>
      <div className="prop-group">
        <label>随机种子 {g.seed.toFixed(1)}</label>
        <NumberInput value={g.seed} min={0} max={100} step={0.1} onChange={(v) => set({ seed: v })} />
      </div>
    </div>
  );
}

export function NodePalette() {
  const categories = ['输入', '图案', '颜色', '数学', '输出'];
  return (
    <div className="node-palette">
      <h4>节点库（拖入画布）</h4>
      {categories.map((cat) => (
        <div key={cat}>
          <h4>{cat}</h4>
          {NODE_DEFS.filter((d) => d.category === cat).map((d) => (
            <div
              key={d.type}
              className="palette-node"
              draggable
              onDragStart={(e) => e.dataTransfer.setData('node-type', d.type)}
            >
              {d.label}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
