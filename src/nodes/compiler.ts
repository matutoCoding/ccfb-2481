// 材质图 -> GLSL 编译器：校验、拓扑排序、代码生成、uniform 收集
import type {
  CompileResult, GraphNode, MaterialGraph, NodeError, ParamValue, PortType, UniformSpec,
} from '../types';
import { getNodeDef, portTypeOf } from './defs';
import { GLSL_LIB } from './glslLib';

export const OUTPUT_NODE_TYPE = 'output';
const MAX_RAMP_STOPS = 8;

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

function varName(nodeId: string, portId: string): string {
  return `v_${sanitize(nodeId)}_${sanitize(portId)}`;
}

function uniformName(nodeId: string, paramId: string, suffix = ''): string {
  return `u_${sanitize(nodeId)}_${sanitize(paramId)}${suffix}`;
}

/** 图结构校验：输出节点唯一、端口存在、类型匹配、无环、可达 */
export function validateGraph(graph: MaterialGraph): NodeError[] {
  const errors: NodeError[] = [];
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const outputs = graph.nodes.filter((n) => n.type === OUTPUT_NODE_TYPE);

  if (outputs.length === 0) {
    errors.push({ nodeId: null, message: '缺少「材质输出」节点' });
    return errors;
  }
  if (outputs.length > 1) {
    outputs.slice(1).forEach((n) =>
      errors.push({ nodeId: n.id, message: '存在多个材质输出节点，只允许一个' }));
  }
  const output = outputs[0];

  for (const node of graph.nodes) {
    const def = getNodeDef(node.type);
    if (!def) {
      errors.push({ nodeId: node.id, message: `未知节点类型「${node.type}」` });
      continue;
    }
    for (const [portId, ref] of Object.entries(node.inputs)) {
      const inputDef = def.inputs.find((p) => p.id === portId);
      if (!inputDef) {
        errors.push({ nodeId: node.id, portId, message: `节点「${def.label}」不存在输入端口「${portId}」` });
        continue;
      }
      const src = nodeMap.get(ref.node);
      if (!src) {
        errors.push({ nodeId: node.id, portId, message: `端口「${inputDef.name}」连接的节点已被删除` });
        continue;
      }
      const srcDef = getNodeDef(src.type);
      if (!srcDef) continue;
      const srcPort = srcDef.outputs.find((p) => p.id === ref.port);
      if (!srcPort) {
        errors.push({ nodeId: ref.node, portId: ref.port, message: `节点「${srcDef.label}」不存在输出端口「${ref.port}」` });
        continue;
      }
      const dstType = portTypeOf(def, portId, 'in');
      if (dstType && srcPort.type !== dstType) {
        errors.push({
          nodeId: node.id,
          portId,
          message: `类型不匹配：端口「${inputDef.name}」需要 ${dstType}，但「${srcDef.label}.${srcPort.name}」输出 ${srcPort.type}`,
        });
      }
    }
  }
  if (errors.length) return errors;

  // 环检测 + 收集输出节点可达集合
  const visitState = new Map<string, 0 | 1 | 2>(); // 0 未访问 1 栈中 2 完成
  const reachable = new Set<string>();
  const walk = (node: GraphNode, path: string[]): boolean => {
    const state = visitState.get(node.id) ?? 0;
    if (state === 1) {
      const cycleStart = path.indexOf(node.id);
      const cycleNodes = path.slice(cycleStart).concat(node.id);
      cycleNodes.forEach((id) =>
        errors.push({ nodeId: id, message: `检测到连线环路：${cycleNodes.map((x) => nodeMap.get(x) && getNodeDef(nodeMap.get(x)!.type)?.label).join(' → ')}` }));
      return false;
    }
    if (state === 2) return true;
    visitState.set(node.id, 1);
    reachable.add(node.id);
    for (const ref of Object.values(node.inputs)) {
      const src = nodeMap.get(ref.node);
      if (src && !walk(src, [...path, node.id])) return false;
    }
    visitState.set(node.id, 2);
    return true;
  };
  walk(output, []);

  // 悬空节点（不可达）只警告，不报错 —— 作为错误返回会阻塞编辑，这里放到 console 级提示
  return errors;
}

function topoSort(graph: MaterialGraph, rootId: string): GraphNode[] {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const order: GraphNode[] = [];
  const done = new Set<string>();
  const visit = (node: GraphNode) => {
    if (done.has(node.id)) return;
    Object.values(node.inputs)
      .map((ref) => nodeMap.get(ref.node))
      .filter(Boolean)
      .forEach((src) => visit(src!));
    done.add(node.id);
    order.push(node);
  };
  visit(nodeMap.get(rootId)!);
  return order;
}

function glslType(t: PortType): string {
  return t === 'float' ? 'float' : t === 'vec2' ? 'vec2' : 'vec3';
}

function defaultLiteral(t: PortType): string {
  if (t === 'float') return '0.5';
  if (t === 'vec2') return 'vec2(0.0, 0.0)';
  return 'vec3(0.5, 0.5, 0.5)';
}

/** 把参数登记为 uniform（ramp 展开为 positions/colors/count） */
function pushUniform(
  specs: UniformSpec[], node: GraphNode, paramId: string, typeHint: string, value: ParamValue,
): string {
  if (typeHint === 'ramp') {
    const flat = (value as number[]) ?? [];
    const stops: { pos: number; rgb: number[] }[] = [];
    for (let i = 0; i + 3 < flat.length; i += 4) {
      stops.push({ pos: flat[i], rgb: [flat[i + 1], flat[i + 2], flat[i + 3]] });
    }
    stops.sort((a, b) => a.pos - b.pos);
    const count = Math.min(stops.length, MAX_RAMP_STOPS);
    const positions = new Array(MAX_RAMP_STOPS).fill(0);
    const colors: number[] = [];
    for (let i = 0; i < MAX_RAMP_STOPS; i++) {
      const s = stops[Math.min(i, Math.max(0, count - 1))] ?? { pos: i / (MAX_RAMP_STOPS - 1), rgb: [0.5, 0.5, 0.5] };
      positions[i] = s.pos;
      colors.push(...s.rgb);
    }
    specs.push({ name: uniformName(node.id, paramId, '_pos'), type: 'floatArray', value: positions });
    specs.push({ name: uniformName(node.id, paramId, '_col'), type: 'vec3Array', value: colors });
    specs.push({ name: uniformName(node.id, paramId, '_count'), type: 'int', value: count });
    // 返回供 emit 模板使用的“表达式前缀”，由 resolveTemplate 特殊处理
    return uniformName(node.id, paramId);
  }
  const name = uniformName(node.id, paramId);
  if (typeHint === 'color') {
    specs.push({ name, type: 'vec3', value: (value as number[]) ?? [0.5, 0.5, 0.5] });
  } else if (typeHint === 'vector2') {
    specs.push({ name, type: 'vec2', value: (value as number[]) ?? [0, 0] });
  } else if (typeHint === 'boolean' || typeHint === 'select') {
    let v = value as unknown;
    if (typeHint === 'select') {
      const def = getNodeDef(node.type)!;
      const pd = def.params.find((p) => p.id === paramId)!;
      v = Math.max(0, (pd.options ?? []).findIndex((o) => o.value === value));
    }
    specs.push({ name, type: 'int', value: (v as number) ?? 0 });
  } else {
    specs.push({ name, type: 'float', value: (value as number) ?? 0 });
  }
  return name;
}

export function compileGraph(graph: MaterialGraph): CompileResult {
  const errors = validateGraph(graph);
  const lineMap: Record<number, string> = {};
  const uniforms: UniformSpec[] = [];
  if (errors.length) {
    return { ok: false, glsl: '', errors, uniforms, lineMap };
  }

  const output = graph.nodes.find((n) => n.type === OUTPUT_NODE_TYPE)!;
  const order = topoSort(graph, output.id);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const lines: string[] = [];

  // lineMap 的 key 是「生成代码内部行号」（从 1 开始，不含拼接时的 header/lib 前缀）
  let lineCounter = 0;
  const pushLine = (text: string, nodeId: string | null) => {
    lineCounter += 1;
    lines.push(text);
    if (nodeId) lineMap[lineCounter] = nodeId;
  };

  pushLine('struct MaterialOut {', null);
  pushLine('  vec3 baseColor; float roughness; float metallic;', null);
  pushLine('  float normalHeight; float thickness; float crackle;', null);
  pushLine('};', null);

  // 所有参数先登记 uniform（顺序稳定，按节点）
  for (const node of order) {
    const def = getNodeDef(node.type);
    if (!def) continue;
    for (const pd of def.params) {
      pushUniform(uniforms, node, pd.id, pd.kind, node.params[pd.id] ?? pd.default);
    }
  }

  // 输出 uniform 声明（全局作用域；ramp 已展开为 positions[8]/colors[8]/count 三个）
  for (const spec of uniforms) {
    if (spec.type === 'floatArray') pushLine(`uniform float ${spec.name}[8];`, null);
    else if (spec.type === 'vec3Array') pushLine(`uniform vec3 ${spec.name}[8];`, null);
    else if (spec.type === 'int') pushLine(`uniform int ${spec.name};`, null);
    else if (spec.type === 'vec2') pushLine(`uniform vec2 ${spec.name};`, null);
    else if (spec.type === 'vec3') pushLine(`uniform vec3 ${spec.name};`, null);
    else pushLine(`uniform float ${spec.name};`, null);
  }

  const resolveTemplate = (node: GraphNode, template: string): string => {
    const def = getNodeDef(node.type)!;
    return template.replace(/\{([pi]):([a-zA-Z0-9_]+)\}/g, (_m, kind: 'p' | 'i', id: string) => {
      if (kind === 'p') {
        const pd = def.params.find((p) => p.id === id);
        if (!pd) return '0.0';
        if (pd.kind === 'ramp') {
          // 模板里 ramp 只出现在函数调用中，需要展开成三个实参
          return `${uniformName(node.id, id, '_pos')}, ${uniformName(node.id, id, '_col')}, ${uniformName(node.id, id, '_count')}`;
        }
        return uniformName(node.id, id);
      }
      const ref = node.inputs[id];
      if (ref) return varName(ref.node, ref.port);
      const inputDef = def.inputs.find((p) => p.id === id);
      return inputDef ? defaultLiteral(inputDef.type) : '0.0';
    });
  };

  // 节点变量与输出组装全部放进函数体（GLSL ES 全局变量初始化必须是常量表达式）
  pushLine('MaterialOut evaluateMaterial() {', null);
  pushLine('  MaterialOut m;', null);

  for (const node of order) {
    const def = getNodeDef(node.type);
    if (!def) continue;
    if (node.type === OUTPUT_NODE_TYPE) continue;
    for (const outPort of def.outputs) {
      // 只生成被下游引用的输出
      const used = graph.nodes.some((n) =>
        Object.values(n.inputs).some((r) => r.node === node.id && r.port === outPort.id));
      if (!used) continue;
      const expr = resolveTemplate(node, def.emit[outPort.id] ?? defaultLiteral(outPort.type));
      pushLine(`  ${glslType(outPort.type)} ${varName(node.id, outPort.id)} = ${expr};`, node.id);
    }
  }

  // 输出节点组装
  const outDef = getNodeDef(OUTPUT_NODE_TYPE)!;
  const outDefaults: Record<string, string> = {
    baseColor: 'vec3(0.72, 0.68, 0.62)',
    roughness: '0.35',
    metallic: '0.0',
    normalHeight: '0.0',
    thickness: '0.6',
    crackle: '0.0',
  };
  for (const port of outDef.inputs) {
    const ref = output.inputs[port.id];
    const rhs = ref ? varName(ref.node, ref.port) : outDefaults[port.id];
    pushLine(`  m.${port.id} = ${rhs};`, output.id);
  }
  pushLine('  return m;', null);
  pushLine('}', null);

  const glsl = ['// ===== 自动生成的材质函数 =====', ...lines].join('\n');
  return { ok: true, glsl, errors: [], uniforms, lineMap };
}

/** 把驱动编译错误文本映射回节点 */
export function mapDriverError(driverLog: string, lineMap: Record<number, string>, lineOffset: number): NodeError[] {
  const result: NodeError[] = [];
  const seen = new Set<string>();
  // 兼容三种主流驱动格式：
  //  ANGLE/Chrome : "ERROR: 0:281: 'x' : undeclared identifier"
  //  Firefox      : "0:281(12): error: ..."
  //  其它         : "281: error: ..." / "line 281: ..."
  const patterns = [
    /\d+:(\d+)\s*:\s*(?:error:\s*)?(.*)/i,       // ERROR: 0:281: ...
    /\d+:(\d+)\(\d+\)\s*:\s*(?:error:\s*)?(.*)/i, // 0:281(12): error: ...
    /line\s+(\d+)\s*:\s*(?:error:\s*)?(.*)/i,     // line 281: ...
    /(?:^|\s)(\d+)\s*:\s*(?:error:\s*)?(.*)/i,    // 281: error: ...
  ];

  for (const rawLine of driverLog.split('\n')) {
    const text = rawLine.trim();
    if (!text) continue;
    let line = NaN;
    let msg = '';
    for (const re of patterns) {
      const m = re.exec(text);
      if (m) { line = parseInt(m[1], 10); msg = (m[2] ?? text).trim(); break; }
    }
    if (!Number.isFinite(line) || line === 0) continue;
    // lineMap 的 key 是生成代码内部物理行号（已含注释行偏移），换算回相对行
    const materialLine = line - lineOffset;
    const nodeId = lineMap[materialLine] ?? null;
    const key = `${nodeId}-${msg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(nodeId
      ? { nodeId, message: `GLSL 编译错误（行 ${line}）：${msg}` }
      : { nodeId: null, message: `GLSL 编译错误（行 ${line}，未定位到具体节点）：${msg}` });
  }
  if (result.length === 0) {
    result.push({ nodeId: null, message: `Shader 编译失败：${driverLog.split('\n').slice(0, 4).join(' ')}` });
  }
  return result;
}
