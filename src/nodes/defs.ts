// 节点定义：节点类型清单、端口、参数与代码生成描述
import type { ParamDef, PortDef, PortType } from '../types';

export interface NodeDef {
  type: string;
  category: '输入' | '图案' | '颜色' | '数学' | '输出';
  label: string;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
  /** 每个输出端口的 GLSL 表达式模板，{p:id}=参数引用，{i:id}=输入变量 */
  emit: Record<string, string>;
  /** 需要注入到材质函数外的 GLSL 辅助函数名（见 glslLib） */
  uses?: string[];
  /** 是否为单例（输出节点） */
  singleton?: boolean;
}

const rampDef: ParamDef = {
  id: 'stops',
  name: '色带',
  kind: 'ramp',
  default: [0, 0.08, 0.05, 0.04, 0.5, 0.35, 0.2, 0.12, 1, 0.85, 0.78, 0.7],
};

export const NODE_DEFS: NodeDef[] = [
  {
    type: 'output',
    category: '输出',
    label: '材质输出',
    singleton: true,
    inputs: [
      { id: 'baseColor', name: '釉色', type: 'vec3' },
      { id: 'roughness', name: '粗糙度', type: 'float' },
      { id: 'metallic', name: '金属度', type: 'float' },
      { id: 'normalHeight', name: '凹凸高度', type: 'float' },
      { id: 'thickness', name: '釉厚', type: 'float' },
      { id: 'crackle', name: '裂纹遮罩', type: 'float' },
    ],
    outputs: [],
    params: [],
    emit: {},
  },
  {
    type: 'coord',
    category: '输入',
    label: '坐标',
    inputs: [],
    outputs: [
      { id: 'uv', name: 'UV', type: 'vec2' },
      { id: 'local', name: '局部坐标', type: 'vec3' },
      { id: 'normal', name: '法线', type: 'vec3' },
    ],
    params: [
      { id: 'uvScale', name: 'UV 缩放', kind: 'vector2', default: [1, 1] },
    ],
    emit: {
      uv: '(vUv * {p:uvScale})',
      local: 'vLocalPos',
      normal: 'vNormalW',
    },
  },
  {
    type: 'constant',
    category: '输入',
    label: '常量',
    inputs: [],
    outputs: [
      { id: 'value', name: '数值', type: 'float' },
      { id: 'color', name: '颜色', type: 'vec3' },
    ],
    params: [
      { id: 'num', name: '数值', kind: 'number', default: 0.5, min: -10, max: 10, step: 0.01 },
      { id: 'rgb', name: '颜色', kind: 'color', default: [0.6, 0.55, 0.5] },
    ],
    emit: { value: '{p:num}', color: '{p:rgb}' },
  },
  {
    type: 'noise2d',
    category: '图案',
    label: '二维噪声',
    inputs: [{ id: 'uv', name: 'UV', type: 'vec2' }],
    outputs: [{ id: 'out', name: '噪声', type: 'float' }],
    params: [
      { id: 'scale', name: '缩放', kind: 'number', default: 6, min: 0.1, max: 64, step: 0.1 },
      { id: 'octaves', name: '叠加层数', kind: 'select', default: '3', options: [
        { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' },
      ] },
    ],
    uses: ['fbm2'],
    emit: { out: 'fbm2(({i:uv}) * {p:scale}, {p:octaves})' },
  },
  {
    type: 'noise3d',
    category: '图案',
    label: '三维噪声',
    inputs: [{ id: 'coord', name: '坐标', type: 'vec3' }],
    outputs: [{ id: 'out', name: '噪声', type: 'float' }],
    params: [
      { id: 'scale', name: '缩放', kind: 'number', default: 4, min: 0.1, max: 64, step: 0.1 },
      { id: 'octaves', name: '叠加层数', kind: 'select', default: '3', options: [
        { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' },
      ] },
    ],
    uses: ['fbm3'],
    emit: { out: 'fbm3(({i:coord}) * {p:scale}, {p:octaves})' },
  },
  {
    type: 'gradient',
    category: '颜色',
    label: '渐变映射',
    inputs: [{ id: 't', name: '输入值', type: 'float' }],
    outputs: [
      { id: 'color', name: '颜色', type: 'vec3' },
      { id: 'value', name: '数值', type: 'float' },
    ],
    params: [rampDef],
    uses: ['rampSample3', 'rampSample1'],
    emit: {
      color: 'rampSample3({p:stops}, clamp({i:t}, 0.0, 1.0))',
      value: 'rampSample1({p:stops}, clamp({i:t}, 0.0, 1.0))',
    },
  },
  {
    type: 'crackle',
    category: '图案',
    label: '开片裂纹',
    inputs: [{ id: 'uv', name: 'UV', type: 'vec2' }],
    outputs: [
      { id: 'mask', name: '裂纹遮罩', type: 'float' },
      { id: 'height', name: '凹凸', type: 'float' },
    ],
    params: [
      { id: 'scale', name: '裂纹密度', kind: 'number', default: 8, min: 1, max: 60, step: 0.5 },
      { id: 'width', name: '裂纹宽度', kind: 'number', default: 0.03, min: 0.005, max: 0.15, step: 0.005 },
      { id: 'jitter', name: '扭曲', kind: 'number', default: 0.35, min: 0, max: 1, step: 0.05 },
    ],
    uses: ['crackle2'],
    emit: {
      mask: 'crackle2({i:uv}, {p:scale}, {p:width}, {p:jitter}, uSeed).x',
      height: 'crackle2({i:uv}, {p:scale}, {p:width}, {p:jitter}, uSeed).y',
    },
  },
  {
    type: 'flow',
    category: '图案',
    label: '流釉',
    inputs: [{ id: 'coord', name: '坐标', type: 'vec3' }],
    outputs: [
      { id: 'mask', name: '流釉遮罩', type: 'float' },
      { id: 'height', name: '厚度变化', type: 'float' },
    ],
    params: [
      { id: 'scale', name: '纹理缩放', kind: 'number', default: 3, min: 0.2, max: 20, step: 0.1 },
      { id: 'streak', name: '拉伸', kind: 'number', default: 2.5, min: 0.2, max: 8, step: 0.1 },
      { id: 'threshold', name: '阈值', kind: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    uses: ['flowGlaze'],
    emit: {
      mask: 'flowGlaze({i:coord}, {p:scale}, {p:streak}, {p:threshold}, uSeed).x',
      height: 'flowGlaze({i:coord}, {p:scale}, {p:streak}, {p:threshold}, uSeed).y',
    },
  },
  {
    type: 'fresnel',
    category: '图案',
    label: '菲涅尔',
    inputs: [
      { id: 'normal', name: '法线', type: 'vec3' },
    ],
    outputs: [{ id: 'out', name: '菲涅尔', type: 'float' }],
    params: [
      { id: 'power', name: '指数', kind: 'number', default: 3, min: 0.2, max: 8, step: 0.1 },
    ],
    uses: [],
    emit: { out: 'pow(clamp(1.0 - dot(normalize({i:normal}), normalize(uViewDir)), 0.0, 1.0), {p:power})' },
  },
  {
    type: 'math',
    category: '数学',
    label: '数学运算',
    inputs: [
      { id: 'a', name: 'A', type: 'float' },
      { id: 'b', name: 'B', type: 'float' },
    ],
    outputs: [{ id: 'out', name: '结果', type: 'float' }],
    params: [
      { id: 'op', name: '运算', kind: 'select', default: 'add', options: [
        { value: 'add', label: '加法 A+B' },
        { value: 'sub', label: '减法 A-B' },
        { value: 'mul', label: '乘法 A*B' },
        { value: 'div', label: '除法 A/B' },
        { value: 'min', label: '最小 min' },
        { value: 'max', label: '最大 max' },
        { value: 'pow', label: '幂 A^B' },
      ] },
    ],
    emit: { out: 'mathOp({p:op}, {i:a}, {i:b})' },
  },
  {
    type: 'combine',
    category: '颜色',
    label: '颜色混合',
    inputs: [
      { id: 'a', name: '颜色 A', type: 'vec3' },
      { id: 'b', name: '颜色 B', type: 'vec3' },
      { id: 'factor', name: '混合系数', type: 'float' },
    ],
    outputs: [{ id: 'out', name: '颜色', type: 'vec3' }],
    params: [
      { id: 'mode', name: '模式', kind: 'select', default: 'mix', options: [
        { value: 'mix', label: '混合 mix' },
        { value: 'mul', label: '相乘' },
        { value: 'add', label: '相加' },
      ] },
    ],
    emit: { out: 'combineOp({p:mode}, {i:a}, {i:b}, clamp({i:factor}, 0.0, 1.0))' },
  },
  {
    type: 'remap',
    category: '数学',
    label: '重映射',
    inputs: [{ id: 'in', name: '输入', type: 'float' }],
    outputs: [{ id: 'out', name: '输出', type: 'float' }],
    params: [
      { id: 'inMin', name: '输入下限', kind: 'number', default: 0, min: -10, max: 10, step: 0.01 },
      { id: 'inMax', name: '输入上限', kind: 'number', default: 1, min: -10, max: 10, step: 0.01 },
      { id: 'outMin', name: '输出下限', kind: 'number', default: 0, min: -10, max: 10, step: 0.01 },
      { id: 'outMax', name: '输出上限', kind: 'number', default: 1, min: -10, max: 10, step: 0.01 },
    ],
    emit: {
      out: 'mix({p:outMin}, {p:outMax}, clamp(({i:in} - {p:inMin}) / max(0.0001, {p:inMax} - {p:inMin}), 0.0, 1.0))',
    },
  },
  {
    type: 'time',
    category: '输入',
    label: '时间',
    inputs: [],
    outputs: [{ id: 't', name: '时间(s)', type: 'float' }],
    params: [],
    emit: { t: 'uTime' },
  },
];

const DEF_MAP = new Map(NODE_DEFS.map((d) => [d.type, d]));

export function getNodeDef(type: string): NodeDef | undefined {
  return DEF_MAP.get(type);
}

export function portTypeOf(def: NodeDef, portId: string, kind: 'in' | 'out'): PortType | undefined {
  const list = kind === 'in' ? def.inputs : def.outputs;
  return list.find((p) => p.id === portId)?.type;
}
