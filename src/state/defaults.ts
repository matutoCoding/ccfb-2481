// 默认材质与新建工厂
import type { GlazeParams, GraphNode, Material, MaterialGraph } from '../types';
import { getNodeDef } from '../nodes/defs';

let seq = 0;
export function uid(prefix = 'n'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 6)}`;
}

export function defaultGlaze(): GlazeParams {
  return {
    bodyColor: [0.82, 0.78, 0.7],
    thicknessScale: 1.0,
    absorption: 0.9,
    ior: 1.5,
    seed: 1.0,
  };
}

export function createNode(type: string, x: number, y: number): GraphNode {
  const def = getNodeDef(type);
  if (!def) throw new Error('未知节点类型: ' + type);
  const params: GraphNode['params'] = {};
  for (const p of def.params) params[p.id] = Array.isArray(p.default) ? [...(p.default as number[])] : p.default;
  return { id: uid('node'), type, pos: { x, y }, params, inputs: {} };
}

/** 青瓷默认材质图：3D 噪声驱动渐变釉色 + 开片 + 菲涅尔改变粗糙度 */
export function defaultGraph(): MaterialGraph {
  const out = createNode('output', 620, 220);
  const coord = createNode('coord', 60, 80);
  const n3 = createNode('noise3d', 260, 80);
  n3.params.scale = 3.5;
  const grad = createNode('gradient', 440, 80);
  grad.params.stops = [
    0, 0.16, 0.28, 0.24,
    0.55, 0.28, 0.45, 0.38,
    1, 0.62, 0.72, 0.66,
  ];
  const crack = createNode('crackle', 260, 320);
  crack.params.scale = 10;
  const fres = createNode('fresnel', 260, 520);
  const rough = createNode('remap', 440, 520);
  rough.params.outMin = 0.15;
  rough.params.outMax = 0.5;
  const flow = createNode('flow', 60, 320);

  n3.inputs.coord = { node: coord.id, port: 'local' };
  grad.inputs.t = { node: n3.id, port: 'out' };
  crack.inputs.uv = { node: coord.id, port: 'uv' };
  fres.inputs.normal = { node: coord.id, port: 'normal' };
  rough.inputs.in = { node: fres.id, port: 'out' };
  flow.inputs.coord = { node: coord.id, port: 'local' };

  out.inputs.baseColor = { node: grad.id, port: 'color' };
  out.inputs.roughness = { node: rough.id, port: 'out' };
  out.inputs.normalHeight = { node: flow.id, port: 'height' };
  out.inputs.thickness = { node: flow.id, port: 'mask' };
  out.inputs.crackle = { node: crack.id, port: 'mask' };

  return { nodes: [out, coord, n3, grad, crack, fres, rough, flow] };
}

export function createMaterial(name = '未命名釉色'): Material {
  const now = Date.now();
  return {
    id: uid('mat'),
    name,
    graph: defaultGraph(),
    glaze: defaultGlaze(),
    createdAt: now,
    updatedAt: now,
  };
}

/** 节点深拷贝（含重新分配 id 与输入引用修正） */
export function cloneNodes(nodes: GraphNode[], offset = { x: 40, y: 40 }): GraphNode[] {
  const idMap = new Map<string, string>();
  const copies = nodes.map((n) => {
    const newId = uid('node');
    idMap.set(n.id, newId);
    return {
      ...n,
      id: newId,
      pos: { x: n.pos.x + offset.x, y: n.pos.y + offset.y },
      params: JSON.parse(JSON.stringify(n.params)),
      inputs: { ...n.inputs },
    };
  });
  copies.forEach((c) => {
    for (const [port, ref] of Object.entries(c.inputs)) {
      if (idMap.has(ref.node)) c.inputs[port] = { node: idMap.get(ref.node)!, port: ref.port };
    }
  });
  return copies;
}
