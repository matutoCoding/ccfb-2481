// 旋转轮廓成型：Catmull-Rom 采样轮廓 -> 旋转网格
// UV 的 v 按轮廓弧长分配（防纵向拉花），u 按极角分配并复制接缝列（防横向接缝）
import { catmullRom } from '../webgl/mat4';
import type { ProfilePoint, Vessel } from '../types';

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  thickness: Float32Array;
  indices: Uint32Array;
  indexCount: number;
  height: number;
}

interface SampledCurve {
  pts: { r: number; y: number }[];
  /** 累计弧长 */
  arc: number[];
  totalArc: number;
}

/** 对轮廓控制点做 Catmull-Rom 密集采样 */
function sampleProfile(profile: ProfilePoint[], heightSegments: number): SampledCurve {
  const pts = profile.map((p) => ({ ...p }));
  const n = pts.length;
  const out: { r: number; y: number }[] = [];
  const stepsPerSpan = Math.max(2, Math.ceil(heightSegments / Math.max(1, n - 1)));

  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    for (let s = 0; s < stepsPerSpan; s++) {
      const t = s / stepsPerSpan;
      out.push({
        r: catmullRom(p0.r, p1.r, p2.r, p3.r, t),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
      });
    }
  }
  out.push({ ...pts[n - 1] });

  // 半径钳为非负
  out.forEach((p) => { p.r = Math.max(0, p.r); });

  const arc = [0];
  for (let i = 1; i < out.length; i++) {
    const dr = out[i].r - out[i - 1].r;
    const dy = out[i].y - out[i - 1].y;
    arc.push(arc[i - 1] + Math.hypot(dr, dy));
  }
  return { pts: out, arc, totalArc: arc[arc.length - 1] || 1 };
}

export function buildLatheMesh(vessel: Vessel): MeshData {
  const profile = vessel.profile.length >= 2 ? vessel.profile : DEFAULT_PROFILE;
  const curve = sampleProfile(profile, vessel.heightSegments);
  const rings = curve.pts.length;
  const cols = vessel.radialSegments + 1; // 接缝复制列
  const vertexCount = rings * cols;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const thickness = new Float32Array(vertexCount);
  const indices: number[] = [];

  // 每环的轮廓法线（二维）与釉厚
  const ringNormal: { nr: number; ny: number }[] = [];
  const ringThickness: number[] = [];
  for (let i = 0; i < rings; i++) {
    const a = curve.pts[Math.max(0, i - 1)];
    const b = curve.pts[Math.min(rings - 1, i + 1)];
    let dr = b.r - a.r;
    let dy = b.y - a.y;
    const len = Math.hypot(dr, dy) || 1;
    dr /= len; dy /= len;
    // 轮廓切线 (dr,dy)，朝外法线 (dy,-dr)
    let nr = dy;
    let ny = -dr;
    if (nr < 0) { nr = -nr; ny = -ny; } // 保证朝 +r 外侧
    ringNormal.push({ nr, ny });

    const v = curve.arc[i] / curve.totalArc;
    // 曲率近似：相邻切线夹角
    const pa = curve.pts[Math.max(0, i - 1)];
    const pc = curve.pts[Math.min(rings - 1, i + 1)];
    const curvature = Math.abs((pc.r - pa.r) * dy - (pc.y - pa.y) * dr);
    // 重力堆积：底部厚；曲率大处略厚
    ringThickness.push(0.3 + 0.55 * (1 - v) + Math.min(0.3, curvature * 2.0));
  }

  const yMin = Math.min(...curve.pts.map((p) => p.y));
  const yMax = Math.max(...curve.pts.map((p) => p.y));
  const height = Math.max(0.0001, yMax - yMin);

  for (let i = 0; i < rings; i++) {
    const { r, y } = curve.pts[i];
    const v = curve.arc[i] / curve.totalArc;
    const { nr, ny } = ringNormal[i];
    for (let j = 0; j < cols; j++) {
      const u = j / (cols - 1);
      const theta = u * Math.PI * 2;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      const idx = i * cols + j;
      positions[idx * 3] = r * ct;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = r * st;
      normals[idx * 3] = nr * ct;
      normals[idx * 3 + 1] = ny;
      normals[idx * 3 + 2] = nr * st;
      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;
      thickness[idx] = ringThickness[i];
    }
  }

  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = (i + 1) * cols + j;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  return {
    positions,
    normals,
    uvs,
    thickness,
    indices: Uint32Array.from(indices),
    indexCount: indices.length,
    height,
  };
}

export const DEFAULT_PROFILE: ProfilePoint[] = [
  { r: 0.0, y: 0.0 },
  { r: 0.32, y: 0.02 },
  { r: 0.42, y: 0.18 },
  { r: 0.4, y: 0.45 },
  { r: 0.28, y: 0.72 },
  { r: 0.26, y: 0.95 },
  { r: 0.3, y: 1.0 },
];
