// 器型页：旋转轮廓 SVG 编辑器 + 器型管理 + 3D 预览
import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { VESSEL_PRESETS } from '../vessel/presets';
import { PreviewCanvas } from '../components/PreviewCanvas';
import type { ProfilePoint } from '../types';

const VIEW_W = 520;
const VIEW_H = 560;
const PAD = 60;

export function VesselPage() {
  const { state, currentVessel, dispatch, notify } = useStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  if (!currentVessel) {
    return (
      <div className="page-body">
        <button className="btn primary" onClick={() => dispatch({ type: 'create-vessel', fromPreset: 0 })}>
          创建第一个器型
        </button>
      </div>
    );
  }

  const maxR = Math.max(0.3, ...currentVessel.profile.map((p) => p.r));
  const maxY = Math.max(0.5, ...currentVessel.profile.map((p) => p.y));
  const plotH = VIEW_H - PAD * 2;
  const plotW = VIEW_W / 2 - PAD;

  const toScreen = (p: ProfilePoint) => ({
    x: VIEW_W / 2 - (p.r / maxR) * plotW,
    y: PAD + plotH - (p.y / maxY) * plotH,
  });
  const toProfile = (sx: number, sy: number): ProfilePoint => ({
    r: Math.max(0, Math.min(1, ((VIEW_W / 2 - sx) / plotW) * maxR)),
    y: Math.max(0, Math.min(maxY, ((PAD + plotH - sy) / plotH) * maxY)),
  });

  const updateProfile = (profile: ProfilePoint[]) => {
    dispatch({
      type: 'update-vessel',
      id: currentVessel.id,
      patch: { profile: profile.map((p, i) => ({ ...p, y: i === 0 ? Math.min(p.y, 0) : p.y })) },
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragIdx === null) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const sy = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    const p = toProfile(sx, sy);
    const profile = currentVessel.profile.map((q, i) => {
      if (i !== dragIdx) return q;
      // 端点约束：首点 r=0（底心），保持 y 单调
      const prev = currentVessel.profile[i - 1];
      const next = currentVessel.profile[i + 1];
      let y = p.y;
      if (prev) y = Math.max(y, prev.y + 0.01);
      if (next) y = Math.min(y, next.y - 0.01);
      return { r: i === 0 ? 0 : p.r, y };
    });
    updateProfile(profile);
  };

  const addPoint = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.handle) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const sy = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    const p = toProfile(sx, sy);
    const profile = [...currentVessel.profile, p].sort((a, b) => a.y - b.y);
    updateProfile(profile);
    notify('已添加轮廓控制点');
  };

  const removePoint = (idx: number) => {
    if (currentVessel.profile.length <= 3) { notify('至少保留 3 个控制点'); return; }
    updateProfile(currentVessel.profile.filter((_, i) => i !== idx));
  };

  const linePath = currentVessel.profile
    .map((p, i) => {
      const s = toScreen(p);
      return `${i === 0 ? 'M' : 'L'} ${s.x.toFixed(1)} ${s.y.toFixed(1)}`;
    })
    .join(' ');
  const mirrorPath = currentVessel.profile
    .map((p, i) => {
      const s = toScreen(p);
      return `${i === 0 ? 'M' : 'L'} ${(VIEW_W - s.x).toFixed(1)} ${s.y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <>
      <div className="page-header">
        <h2>器型编辑</h2>
        <span className="sub">旋转轮廓线成型 · UV 按弧长展开不会拉花 · 拖拽控制点，点空白处加点</span>
      </div>
      <div className="page-body">
        <div className="vessel-layout">
          <div className="vessel-canvas-box">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              onPointerMove={onPointerMove}
              onPointerUp={() => setDragIdx(null)}
              onClick={addPoint}
            >
              {/* 网格 */}
              {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                <g key={t} stroke="#2a2f37" strokeWidth={1}>
                  <line x1={PAD} x2={VIEW_W - PAD} y1={PAD + plotH * t} y2={PAD + plotH * t} />
                </g>
              ))}
              <line x1={VIEW_W / 2} x2={VIEW_W / 2} y1={PAD} y2={PAD + plotH} stroke="#3a414c" strokeDasharray="6 5" />
              <text x={VIEW_W / 2 + 6} y={PAD - 8} fill="#7c8aa0" fontSize={12}>旋转轴</text>

              {/* 轮廓与镜像 */}
              <path d={`${linePath} L ${VIEW_W / 2} ${toScreen(currentVessel.profile[currentVessel.profile.length - 1]).y} L ${VIEW_W / 2} ${toScreen(currentVessel.profile[0]).y} Z`}
                fill="rgba(110,168,254,0.10)" stroke="none" />
              <path d={mirrorPath} fill="none" stroke="#55708f" strokeWidth={1.5} strokeDasharray="4 4" />
              <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2.5} />

              {/* 控制点 */}
              {currentVessel.profile.map((p, i) => {
                const s = toScreen(p);
                return (
                  <g key={i}>
                    <circle
                      cx={s.x} cy={s.y} r={8}
                      fill="var(--accent)" stroke="#111" strokeWidth={2}
                      style={{ cursor: 'grab' }}
                      data-handle="1"
                      onPointerDown={(e) => { e.stopPropagation(); setDragIdx(i); }}
                      onDoubleClick={(e) => { e.stopPropagation(); removePoint(i); }}
                    />
                    <text x={s.x - 4} y={s.y - 12} fontSize={10} fill="#9aa3af" pointerEvents="none">
                      r{p.r.toFixed(2)} h{p.y.toFixed(2)}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="preview-hint">双击控制点删除 · 底部首点固定在旋转轴上</div>
          </div>

          <div className="vessel-side">
            <div className="export-panel">
              <h3>{currentVessel.name}</h3>
              <input
                type="text"
                value={currentVessel.name}
                onChange={(e) => dispatch({ type: 'update-vessel', id: currentVessel.id, patch: { name: e.target.value } })}
              />
              <div className="prop-group" style={{ marginTop: 12 }}>
                <label>径向分段 {currentVessel.radialSegments}（越高越圆润）</label>
                <input
                  type="range" min={24} max={192} step={8}
                  value={currentVessel.radialSegments}
                  onChange={(e) => dispatch({
                    type: 'update-vessel', id: currentVessel.id,
                    patch: { radialSegments: parseInt(e.target.value, 10) },
                  })}
                />
              </div>
              <div className="prop-group">
                <label>高度分段 {currentVessel.heightSegments}</label>
                <input
                  type="range" min={40} max={320} step={10}
                  value={currentVessel.heightSegments}
                  onChange={(e) => dispatch({
                    type: 'update-vessel', id: currentVessel.id,
                    patch: { heightSegments: parseInt(e.target.value, 10) },
                  })}
                />
              </div>
            </div>

            <div className="export-panel">
              <h3>预设器型</h3>
              <div className="check-grid">
                {VESSEL_PRESETS.map((p, i) => (
                  <button key={p.label} className="btn" onClick={() => dispatch({ type: 'create-vessel', fromPreset: i })}>
                    新建{p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="export-panel">
              <h3>我的器型（{state.vessels.length}）</h3>
              <div className="vessel-list">
                {state.vessels.map((v) => (
                  <div
                    key={v.id}
                    className={`vessel-item ${v.id === currentVessel.id ? 'active' : ''}`}
                    onClick={() => dispatch({ type: 'select-vessel', id: v.id })}
                  >
                    <span>{v.name}</span>
                    <button
                      className="btn small danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (state.vessels.length <= 1) { notify('至少保留一个器型'); return; }
                        if (confirm(`删除器型「${v.name}」？`)) dispatch({ type: 'delete-vessel', id: v.id });
                      }}
                    >删除</button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ height: 280, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
              <PreviewCanvas showEnvButton={false} height={280} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
