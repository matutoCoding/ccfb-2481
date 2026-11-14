// 渲染预览页：大画布 + 相机/灯光/色调映射/环境控制
import { useRef } from 'react';
import { useStore } from '../state/store';
import { PreviewCanvas } from '../components/PreviewCanvas';
import type { Renderer } from '../webgl/renderer';
import { parseHDR } from '../webgl/hdr';
import type { RenderSettings } from '../types';

function Slider({ label, value, min, max, step, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="prop-group">
      <label>{label} {value.toFixed(step < 1 ? 2 : 0)}{unit}</label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

export function PreviewPage() {
  const { state, dispatch, notify } = useStore();
  const rendererRef = useRef<Renderer | null>(null);
  const s = state.settings;
  const set = (patch: Partial<RenderSettings>) => dispatch({ type: 'settings', patch });

  const onHDR = async (file: File) => {
    const r = rendererRef.current;
    if (!r) return;
    try {
      r.loadHDRImage(await file.arrayBuffer(), parseHDR);
      notify('HDR 环境贴图已加载');
    } catch (e) {
      notify('HDR 加载失败：' + (e as Error).message);
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>渲染预览</h2>
        <span className="sub">实时 PBR 渲染 · 半透明釉层 Beer-Lambert 吸收 · 基于图像的环境照明</span>
      </div>
      <div className="preview-layout">
        <div className="preview-main">
          <PreviewCanvas ref={rendererRef} height="100%" />
        </div>
        <aside className="preview-side">
          <h4>色调映射</h4>
          <div className="switch">
            <span>映射曲线</span>
            <select
              style={{ width: 130 }}
              value={s.tonemap}
              onChange={(e) => set({ tonemap: e.target.value as RenderSettings['tonemap'] })}
            >
              <option value="aces">ACES 电影感</option>
              <option value="reinhard">Reinhard</option>
              <option value="none">线性（不映射）</option>
            </select>
          </div>
          <Slider label="曝光" value={s.exposure} min={0.1} max={4} step={0.05} onChange={(v) => set({ exposure: v })} />
          <div className="switch">
            <span>MSAA 抗锯齿</span>
            <input type="checkbox" checked={s.msaa} onChange={(e) => set({ msaa: e.target.checked })} />
          </div>
          <Slider label="视场角 FOV" value={s.fov} min={20} max={70} step={1} unit="°"
            onChange={(v) => set({ fov: v })} />

          <h4>环境与灯光</h4>
          <Slider label="环境旋转" value={s.envRotation} min={-180} max={180} step={1} unit="°"
            onChange={(v) => set({ envRotation: v })} />
          <Slider label="环境强度" value={s.envIntensity} min={0} max={3} step={0.05}
            onChange={(v) => set({ envIntensity: v })} />
          <Slider label="主光强度" value={s.lightIntensity} min={0} max={6} step={0.1}
            onChange={(v) => set({ lightIntensity: v })} />
          <label className="btn small file-btn" style={{ display: 'block', textAlign: 'center', marginTop: 8 }}>
            上传 .hdr 环境贴图
            <input type="file" accept=".hdr" hidden onChange={(e) => e.target.files?.[0] && onHDR(e.target.files[0])} />
          </label>
          <button className="btn small" style={{ width: '100%', marginTop: 8 }}
            onClick={() => { rendererRef.current?.generateProceduralEnv(Math.random() * 10); notify('已更换摄影棚环境'); }}>
            重新生成程序化摄影棚
          </button>

          <h4>背景</h4>
          <div className="check-grid">
            {([['env', '环境'], ['solid', '纯色'], ['none', '黑色']] as const).map(([v, label]) => (
              <button key={v} className={`btn small ${s.background === v ? 'active' : ''}`}
                onClick={() => set({ background: v })}>{label}</button>
            ))}
          </div>
          {s.background === 'solid' && (
            <div className="prop-group" style={{ marginTop: 10 }}>
              <label>背景颜色</label>
              <input type="color"
                value={'#' + s.backgroundColor.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}
                onChange={(e) => {
                  const n = parseInt(e.target.value.slice(1), 16);
                  set({ backgroundColor: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] });
                }} />
            </div>
          )}

          <h4>当前组合</h4>
          <p className="muted" style={{ lineHeight: 1.7 }}>
            材质：{state.materials.find((m) => m.id === state.currentMaterialId)?.name ?? '—'}<br />
            器型：{state.vessels.find((v) => v.id === state.currentVesselId)?.name ?? '—'}
          </p>
        </aside>
      </div>
    </>
  );
}
