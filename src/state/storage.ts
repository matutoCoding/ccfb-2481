// localStorage 持久化 + 材质/器型打包导入导出
import type { BundleFile, Material, Vessel } from '../types';
import { createMaterial } from './defaults';
import { VESSEL_PRESETS } from '../vessel/presets';

const MAT_KEY = 'glaze-studio:materials:v1';
const VESSEL_KEY = 'glaze-studio:vessels:v1';
const SETTINGS_KEY = 'glaze-studio:settings:v1';
const CURRENT_KEY = 'glaze-studio:current:v1';

export function loadMaterials(): Material[] {
  try {
    const raw = localStorage.getItem(MAT_KEY);
    if (!raw) {
      const seed = createMaterial('青瓷·默认');
      seed.name = '青瓷·默认';
      localStorage.setItem(MAT_KEY, JSON.stringify([seed]));
      return [seed];
    }
    const list = JSON.parse(raw) as Material[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveMaterials(materials: Material[]) {
  localStorage.setItem(MAT_KEY, JSON.stringify(materials));
}

export function loadVessels(): Vessel[] {
  try {
    const raw = localStorage.getItem(VESSEL_KEY);
    if (!raw) {
      const presets = VESSEL_PRESETS.map((p) => p.build());
      localStorage.setItem(VESSEL_KEY, JSON.stringify(presets));
      return presets;
    }
    return JSON.parse(raw) as Vessel[];
  } catch {
    return [];
  }
}

export function saveVessels(vessels: Vessel[]) {
  localStorage.setItem(VESSEL_KEY, JSON.stringify(vessels));
}

export function loadCurrent(): { materialId: string | null; vesselId: string | null } {
  try {
    return JSON.parse(localStorage.getItem(CURRENT_KEY) ?? '{}');
  } catch {
    return { materialId: null, vesselId: null };
  }
}

export function saveCurrent(ids: { materialId: string | null; vesselId: string | null }) {
  localStorage.setItem(CURRENT_KEY, JSON.stringify(ids));
}

export function loadSettings<T>(fallback: T): T {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveSettings<T>(settings: T) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** 打包成 .glazebundle JSON 文件，可直接发给同事 */
export function exportBundle(materials: Material[], vessels: Vessel[]): string {
  const bundle: BundleFile = {
    app: 'glaze-studio',
    version: 1,
    materials: materials.map((m) => ({ ...m, thumbnail: undefined })),
    vessels,
    exportedAt: Date.now(),
  };
  return JSON.stringify(bundle, null, 2);
}

export function parseBundle(text: string): BundleFile {
  const data = JSON.parse(text) as BundleFile;
  if (data.app !== 'glaze-studio' || !Array.isArray(data.materials)) {
    throw new Error('文件不是有效的釉面工坊材质包');
  }
  return data;
}

export function downloadText(filename: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
