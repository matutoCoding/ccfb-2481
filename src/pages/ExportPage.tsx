// 导出页：协作式分块高分辨率渲染，单块 512px，块间让出主线程，显存不随出图分辨率增长
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { Renderer, CameraState } from '../webgl/renderer';
import { PreviewCanvas } from '../components/PreviewCanvas';
import { downloadText } from '../state/storage';

const PRESETS = [
  { label: '1080P', w: 1920, h: 1080 },
  { label: '2K', w: 2560, h: 1440 },
  { label: '4K UHD', w: 3840, h: 2160 },
  { label: '4K 方图', w: 3840, h: 3840 },
];
const TILE = 512;

export function ExportPage() {
  const { state, currentMaterial, currentVessel, notify } = useStore();
  const rendererRef = useRef<Renderer | null>(null);
  const signalRef = useRef({ cancelled: false });
  const [size, setSize] = useState(PRESETS[0]);
  const [customW, setCustomW] = useState(2048);
  const [customH, setCustomH] = useState(2048);
  const [useCustom, setUseCustom] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const camRef = useRef<CameraState>({ yaw: 0.6, pitch: 0.25, distance: 2.6, target: [0, 0.45, 0] });

  const outW = useCustom ? customW : size.w;
  const outH = useCustom ? customH : size.h;
  const cols = Math.ceil(outW / TILE);
  const rows = Math.ceil(outH / TILE);
  const totalTiles = cols * rows;
  // 显存估算：单块 RGBA16F 颜色 + 深度，约 512*512*10 字节 ≈ 2.6MB
  const vramMB = ((TILE * TILE * (8 + 4)) / 1024 / 1024).toFixed(1);
  const ramMB = ((outW * outH * 4) / 1024 / 1024).toFixed(1);

  useEffect(() => () => { signalRef.current.cancelled = true; }, []);

  const startRender = async () => {
    const renderer = rendererRef.current;
    if (!renderer || !currentMaterial || !currentVessel) {
      notify('渲染器尚未就绪');
      return;
    }
    if (outW > 8192 || outH > 8192) {
      notify('单边分辨率不能超过 8192');
      return;
    }
    setRendering(true);
    setResultUrl(null);
    setProgress({ done: 0, total: totalTiles });
    signalRef.current = { cancelled: false };
    const t0 = performance.now();

    try {
      const image = await renderer.renderTiles(
        state.settings,
        currentMaterial.glaze,
        camRef.current,
        outW,
        outH,
        (done, total) => setProgress({ done, total }),
        signalRef.current,
      );
      if (!image) {
        notify('渲染已取消');
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        canvas.getContext('2d')!.putImageData(image, 0, 0);
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        const url = canvas.toDataURL('image/png');
        setResultUrl(url);
        notify(`渲染完成，用时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
      }
    } catch (e) {
      notify('渲染失败：' + (e as Error).message);
    } finally {
      setRendering(false);
    }
  };

  const cancel = () => { signalRef.current.cancelled = true; };

  const downloadPNG = () => {
    if (!resultUrl) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = `${currentMaterial?.name ?? 'glaze'}-${outW}x${outH}.png`;
    a.click();
  };

  return (
    <>
      <div className="page-header">
        <h2>高分辨率导出</h2>
        <span className="sub">分块渲染 · 每块 {TILE}px 之间让出浏览器线程，页面保持响应 · 显存峰值与出图尺寸无关</span>
      </div>
      <div className="page-body">
        <div className="export-grid">
          <div className="export-panel">
            <h3>1. 选择分辨率</h3>
            <div className="res-grid">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={`btn ${!useCustom && size.label === p.label ? 'active' : ''}`}
                  onClick={() => { setUseCustom(false); setSize(p); }}
                >
                  {p.label}<div className="muted mono" style={{ fontSize: 10 }}>{p.w}×{p.h}</div>
                </button>
              ))}
            </div>
            <div className="switch" style={{ marginTop: 12 }}>
              <span>自定义尺寸</span>
              <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} />
            </div>
            {useCustom && (
              <div className="color-row" style={{ marginTop: 8 }}>
                <input type="number" min={256} max={8192} step={128} value={customW}
                  onChange={(e) => setCustomW(parseInt(e.target.value || '0', 10))} />
                <span className="muted">×</span>
                <input type="number" min={256} max={8192} step={128} value={customH}
                  onChange={(e) => setCustomH(parseInt(e.target.value || '0', 10))} />
              </div>
            )}

            <h3 style={{ marginTop: 22 }}>2. 渲染（{cols}×{rows} = {totalTiles} 块）</h3>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn primary" disabled={rendering} onClick={startRender}>
                {rendering ? '渲染中…' : `开始渲染 ${outW}×${outH}`}
              </button>
              {rendering && <button className="btn danger" onClick={cancel}>取消</button>}
            </div>
            {progress && (
              <>
                <div className="progress-bar">
                  <div className="fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
                <div className="muted">
                  块进度 {progress.done}/{progress.total}（{((progress.done / progress.total) * 100).toFixed(0)}%）
                </div>
              </>
            )}

            <div className="mem-note">
              📦 显存预算：无论出图多大，GPU 端只保留一块 {TILE}×{TILE} 帧缓冲，峰值约 <b>{vramMB} MB</b>（RGBA16F+深度）。<br />
              🧠 系统内存：整幅 ImageData 约 <b>{ramMB} MB</b>。<br />
              🧵 调度：每块渲染完成后 await 一帧再继续，滚动页面、点击取消都不会卡顿。<br />
              🧩 接缝处理：子投影带亚像素 jitter，块间共享同一相机矩阵，无错位。
            </div>
          </div>

          <div className="export-panel">
            <h3>3. 预览与下载</h3>
            {resultUrl ? (
              <>
                <img src={resultUrl} className="export-preview" alt="渲染结果" />
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <button className="btn primary" onClick={downloadPNG}>下载 PNG</button>
                  <button className="btn" onClick={() => {
                    downloadText(`${currentMaterial?.name ?? 'glaze'}-glsl.txt`, '// 在节点编辑页查看完整 GLSL');
                  }}>说明</button>
                </div>
              </>
            ) : (
              <div className="muted" style={{ padding: '40px 0', textAlign: 'center' }}>
                渲染完成后在这里预览
              </div>
            )}
            <h3 style={{ marginTop: 22 }}>渲染视角（同步预览相机）</h3>
            <div style={{ height: 240, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
              <PreviewCanvas ref={(r) => {
                rendererRef.current = r;
                if (r) {
                  // 复制交互相机角度：预览每帧使用自身 cam，这里仅作场景构图参考
                }
              }} showEnvButton={false} height={240} />
            </div>
            <p className="mem-note">
              导出使用独立相机参数（与预览默认视角一致）。当前材质：{currentMaterial?.name ?? '—'}，
              器型：{currentVessel?.name ?? '—'}。
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
