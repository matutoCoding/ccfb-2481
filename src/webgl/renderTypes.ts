// renderer 与其他模块共享的类型重导出
export type { CompileResult, GlazeParams, Material, RenderSettings } from '../types';
import type { MeshData } from '../vessel/lathe';

export type MeshDataLike = Pick<
  MeshData,
  'positions' | 'normals' | 'uvs' | 'thickness' | 'indices' | 'indexCount'
>;
