// 全局类型定义：材质图、节点、器型、应用状态

export type PortType = 'float' | 'vec2' | 'vec3';

export interface PortDef {
  id: string;
  name: string;
  type: PortType;
}

export type ParamValue = number | boolean | string | number[];

export interface ParamDef {
  id: string;
  name: string;
  kind: 'number' | 'color' | 'select' | 'boolean' | 'vector2' | 'ramp';
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  default: ParamValue;
}

export interface ConnectionRef {
  node: string; // 源节点 id
  port: string; // 源输出端口 id
}

export interface GraphNode {
  id: string;
  type: string;
  pos: { x: number; y: number };
  params: Record<string, ParamValue>;
  /** inputPortId -> 上游连接 */
  inputs: Record<string, ConnectionRef>;
}

export interface MaterialGraph {
  nodes: GraphNode[];
}

export interface GlazeParams {
  /** 胎体颜色 */
  bodyColor: [number, number, number];
  /** 釉层整体厚度倍率 */
  thicknessScale: number;
  /** 釉层吸收系数（越大釉厚处颜色越深） */
  absorption: number;
  /** 折射率 (IOR) */
  ior: number;
  /** 全局随机种子 */
  seed: number;
}

export interface Material {
  id: string;
  name: string;
  graph: MaterialGraph;
  glaze: GlazeParams;
  thumbnail?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProfilePoint {
  r: number; // 半径
  y: number; // 高度
}

export interface Vessel {
  id: string;
  name: string;
  /** 旋转轮廓控制点，自底向上 */
  profile: ProfilePoint[];
  radialSegments: number;
  heightSegments: number;
  updatedAt: number;
}

export interface RenderSettings {
  exposure: number;
  tonemap: 'aces' | 'reinhard' | 'none';
  msaa: boolean;
  envRotation: number;
  envIntensity: number;
  lightIntensity: number;
  background: 'env' | 'solid' | 'none';
  backgroundColor: [number, number, number];
  fov: number;
}

export interface NodeError {
  nodeId: string | null;
  portId?: string;
  message: string;
}

export interface CompileResult {
  ok: boolean;
  glsl: string;
  errors: NodeError[];
  uniforms: UniformSpec[];
  /** 生成 GLSL 行号 -> 节点 id，用于映射驱动编译报错 */
  lineMap: Record<number, string>;
}

export interface UniformSpec {
  name: string;
  type: 'float' | 'vec2' | 'vec3' | 'int' | 'floatArray' | 'vec3Array';
  value: number | number[];
}

export type PageId = 'library' | 'editor' | 'vessel' | 'preview' | 'export';

export interface BundleFile {
  app: 'glaze-studio';
  version: number;
  materials: Material[];
  vessels: Vessel[];
  exportedAt: number;
}
