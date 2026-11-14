// 共享 WebGL 预览画布：渲染器生命周期、轨道控制、材质自动编译
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Renderer, type CameraState } from '../webgl/renderer';
import { compileGraph } from '../nodes/compiler';
import { buildLatheMesh } from '../vessel/lathe';
import { parseHDR } from '../webgl/hdr';
import type { NodeError } from '../types';

interface PreviewCanvasProps {
  height?: number | string;
  showEnvButton?: boolean;
  onRenderer?: (r: Renderer | null) => void;
}

export const PreviewCanvas = React.forwardRef<Renderer, PreviewCanvasProps>(
  function PreviewCanvas({ height = '100%', showEnvButton = true, onRenderer }, ref) {
    const { state, currentMaterial, currentVessel, notify } = useStore();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<Renderer | null>(null);
    const camRef = useRef<CameraState>({ yaw: 0.6, pitch: 0.25, distance: 2.6, target: [0, 0.45, 0] });
    const [errors, setErrors] = useState<NodeError[]>([]);
    const [webglFailed, setWebglFailed] = useState<string | null>(null);
    const dragRef = useRef<{ x: number; y: number; button: number } | null>(null);
    const rafRef = useRef<number>(0);

    React.useImperativeHandle(ref, () => rendererRef.current!, []);

    // 初始化渲染器
    useEffect(() => {
      let renderer: Renderer;
      try {
        renderer = new Renderer(canvasRef.current!);
      } catch (e) {
        setWebglFailed((e as Error).message);
        return;
      }
      rendererRef.current = renderer;
      onRenderer?.(renderer);

      const loop = () => {
        const r = rendererRef.current;
        if (r && currentMaterialRef.current && currentVesselRef.current) {
          r.render(state.settings, currentMaterialRef.current.glaze, camRef.current);
          r.present();
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
      return () => {
        cancelAnimationFrame(rafRef.current);
        onRenderer?.(null);
        renderer.dispose();
        rendererRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 用 ref 让 RAF 循环始终读到最新数据，避免每帧重建
    const currentMaterialRef = useRef(currentMaterial);
    const currentVesselRef = useRef(currentVessel);
    const settingsRef = useRef(state.settings);
    currentMaterialRef.current = currentMaterial;
    currentVesselRef.current = currentVessel;
    settingsRef.current = state.settings;

    // 器型 -> 网格
    useEffect(() => {
      if (!rendererRef.current || !currentVessel) return;
      const mesh = buildLatheMesh(currentVessel);
      rendererRef.current.setMesh(mesh);
      camRef.current.target = [0, mesh.height * 0.42, 0];
    }, [currentVessel]);

    // 材质 -> 编译
    useEffect(() => {
      if (!rendererRef.current || !currentMaterial) return;
      const compiled = compileGraph(currentMaterial.graph);
      const errs = rendererRef.current.setMaterial(currentMaterial, compiled);
      setErrors(errs);
      window.dispatchEvent(new CustomEvent('glaze:shader-errors', { detail: errs }));
    }, [currentMaterial]);

    // 轨道控制
    const onPointerDown = (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { x: e.clientX, y: e.clientY, button: e.button };
    };
    const onPointerMove = (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      const cam = camRef.current;
      if (e.shiftKey || d.button === 2) {
        cam.target[0] -= dx * 0.0025 * cam.distance;
        cam.target[2] -= dy * 0.0025 * cam.distance;
      } else {
        cam.yaw += dx * 0.008;
        cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch + dy * 0.008));
      }
    };
    const onPointerUp = () => { dragRef.current = null; };
    const onWheel = (e: React.WheelEvent) => {
      const cam = camRef.current;
      cam.distance = Math.max(0.8, Math.min(8, cam.distance * (1 + Math.sign(e.deltaY) * 0.08)));
    };

    const onHDR = async (file: File) => {
      const r = rendererRef.current;
      if (!r) return;
      try {
        const buf = await file.arrayBuffer();
        r.loadHDRImage(buf, parseHDR);
        notify('环境贴图已加载：' + file.name);
      } catch (e) {
        notify('HDR 加载失败：' + (e as Error).message);
      }
    };

    const regenerateEnv = () => {
      rendererRef.current?.generateProceduralEnv(Math.random() * 10);
      notify('已重新生成摄影棚环境');
    };

    const errorNodes = useMemo(() => new Set(errors.map((e) => e.nodeId).filter(Boolean)), [errors]);

    return (
      <div className="preview-wrap" style={{ height, position: 'relative' }}>
        {webglFailed && (
          <div className="webgl-error">
            <b>WebGL2 不可用</b>
            <p>{webglFailed}</p>
            <p>请使用最新版 Chrome / Firefox / Edge，并确认硬件加速已开启。</p>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="preview-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          onWheel={onWheel}
        />
        {errors.length > 0 && (
          <div className="shader-error-panel">
            <div className="shader-error-title">Shader 编译失败（{errors.length}）</div>
            {errors.slice(0, 5).map((e, i) => (
              <div key={i} className="shader-error-item">
                {e.nodeId ? '⛳ 节点错误：' : '全局错误：'}{e.message}
              </div>
            ))}
          </div>
        )}
        {showEnvButton && (
          <div className="env-toolbar">
            <button className="btn small" onClick={regenerateEnv}>换个摄影棚</button>
            <label className="btn small file-btn">
              加载 HDR
              <input
                type="file"
                accept=".hdr"
                hidden
                onChange={(e) => e.target.files?.[0] && onHDR(e.target.files[0])}
              />
            </label>
          </div>
        )}
        <div className="preview-hint">左键旋转 · 滚轮缩放 · Shift/右键平移</div>
        {errorNodes.size > 0 && <span hidden data-error-nodes={[...errorNodes].join(',')} />}
      </div>
    );
  },
);
