// 全局应用状态：材质/器型/渲染设置/当前选中，含撤销重做与节点剪贴板
import React, { createContext, useContext, useMemo, useReducer, useRef, useCallback } from 'react';
import type {
  BundleFile, GraphNode, Material, PageId, RenderSettings, Vessel,
} from '../types';
import { cloneNodes, createMaterial, uid } from './defaults';
import {
  exportBundle, loadCurrent, loadMaterials, loadSettings, loadVessels,
  parseBundle, saveCurrent, saveMaterials, saveSettings, saveVessels,
} from './storage';
import { VESSEL_PRESETS } from '../vessel/presets';

const HISTORY_LIMIT = 60;

const DEFAULT_SETTINGS: RenderSettings = {
  exposure: 1.1,
  tonemap: 'aces',
  msaa: true,
  envRotation: 0,
  envIntensity: 1.0,
  lightIntensity: 2.2,
  background: 'env',
  backgroundColor: [0.08, 0.08, 0.09],
  fov: 38,
};

interface State {
  page: PageId;
  materials: Material[];
  vessels: Vessel[];
  currentMaterialId: string | null;
  currentVesselId: string | null;
  settings: RenderSettings;
  selectedNodeId: string | null;
  /** 编辑器撤销栈：保存 graph 快照 */
  past: Material['graph'][];
  future: Material['graph'][];
  clipboard: GraphNode[] | null;
  toast: string | null;
}

type Action =
  | { type: 'page'; page: PageId }
  | { type: 'select-material'; id: string }
  | { type: 'select-vessel'; id: string }
  | { type: 'select-node'; id: string | null }
  | { type: 'create-material'; name?: string }
  | { type: 'duplicate-material'; id: string }
  | { type: 'delete-material'; id: string }
  | { type: 'rename-material'; id: string; name: string }
  | { type: 'set-thumbnail'; id: string; thumbnail: string }
  | { type: 'graph-snapshot'; graph: Material['graph'] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'patch-glaze'; patch: Partial<Material['glaze']> }
  | { type: 'settings'; patch: Partial<RenderSettings> }
  | { type: 'create-vessel'; fromPreset?: number }
  | { type: 'update-vessel'; id: string; patch: Partial<Vessel> }
  | { type: 'delete-vessel'; id: string }
  | { type: 'copy-nodes'; nodes: GraphNode[] }
  | { type: 'paste-nodes' }
  | { type: 'import-bundle'; bundle: BundleFile; merge: boolean }
  | { type: 'toast'; message: string | null };

function persist(state: State) {
  saveMaterials(state.materials);
  saveVessels(state.vessels);
  saveSettings(state.settings);
  saveCurrent({ materialId: state.currentMaterialId, vesselId: state.currentVesselId });
}

function currentMaterial(state: State): Material | undefined {
  return state.materials.find((m) => m.id === state.currentMaterialId);
}

/** 把 graph 变更压入撤销栈 */
function withHistory(state: State, graph: Material['graph']): State {
  const mat = currentMaterial(state);
  if (!mat) return state;
  const past = [...state.past, JSON.parse(JSON.stringify(mat.graph))].slice(-HISTORY_LIMIT);
  const materials = state.materials.map((m) =>
    m.id === mat.id ? { ...m, graph, updatedAt: Date.now() } : m);
  return { ...state, materials, past, future: [] };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'page':
      return { ...state, page: action.page };

    case 'select-material':
      return {
        ...state,
        currentMaterialId: action.id,
        selectedNodeId: null,
        past: [],
        future: [],
      };

    case 'select-vessel':
      return { ...state, currentVesselId: action.id };

    case 'select-node':
      return { ...state, selectedNodeId: action.id };

    case 'create-material': {
      const mat = createMaterial(action.name ?? `新釉色 ${state.materials.length + 1}`);
      const materials = [...state.materials, mat];
      const next = {
        ...state, materials, currentMaterialId: mat.id, selectedNodeId: null, past: [], future: [],
      };
      persist(next);
      return next;
    }

    case 'duplicate-material': {
      const src = state.materials.find((m) => m.id === action.id);
      if (!src) return state;
      const copy: Material = {
        ...JSON.parse(JSON.stringify(src)),
        id: uid('mat'),
        name: src.name + ' 副本',
        thumbnail: undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const materials = [...state.materials, copy];
      const next = { ...state, materials, currentMaterialId: copy.id, past: [], future: [] };
      persist(next);
      return next;
    }

    case 'delete-material': {
      const materials = state.materials.filter((m) => m.id !== action.id);
      const next: State = {
        ...state,
        materials,
        currentMaterialId: state.currentMaterialId === action.id
          ? (materials[0]?.id ?? null)
          : state.currentMaterialId,
        past: [],
        future: [],
        selectedNodeId: null,
      };
      persist(next);
      return next;
    }

    case 'rename-material': {
      const materials = state.materials.map((m) =>
        m.id === action.id ? { ...m, name: action.name, updatedAt: Date.now() } : m);
      const next = { ...state, materials };
      persist(next);
      return next;
    }

    case 'set-thumbnail': {
      const materials = state.materials.map((m) =>
        m.id === action.id ? { ...m, thumbnail: action.thumbnail } : m);
      const next = { ...state, materials };
      persist(next);
      return next;
    }

    case 'graph-snapshot': {
      const next = withHistory(state, action.graph);
      persist(next);
      return next;
    }

    case 'undo': {
      const mat = currentMaterial(state);
      if (!mat || state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      const materials = state.materials.map((m) =>
        m.id === mat.id ? { ...m, graph: previous, updatedAt: Date.now() } : m);
      const next: State = {
        ...state,
        materials,
        past: state.past.slice(0, -1),
        future: [JSON.parse(JSON.stringify(mat.graph)), ...state.future].slice(0, HISTORY_LIMIT),
      };
      persist(next);
      return next;
    }

    case 'redo': {
      const mat = currentMaterial(state);
      if (!mat || state.future.length === 0) return state;
      const nextGraph = state.future[0];
      const materials = state.materials.map((m) =>
        m.id === mat.id ? { ...m, graph: nextGraph, updatedAt: Date.now() } : m);
      const next: State = {
        ...state,
        materials,
        past: [...state.past, JSON.parse(JSON.stringify(mat.graph))].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
      };
      persist(next);
      return next;
    }

    case 'patch-glaze': {
      const mat = currentMaterial(state);
      if (!mat) return state;
      const materials = state.materials.map((m) =>
        m.id === mat.id ? { ...m, glaze: { ...m.glaze, ...action.patch }, updatedAt: Date.now() } : m);
      const next = { ...state, materials };
      persist(next);
      return next;
    }

    case 'settings': {
      const next = { ...state, settings: { ...state.settings, ...action.patch } };
      persist(next);
      return next;
    }

    case 'create-vessel': {
      const vessel = action.fromPreset !== undefined
        ? VESSEL_PRESETS[action.fromPreset].build()
        : VESSEL_PRESETS[0].build();
      const vessels = [...state.vessels, vessel];
      const next = { ...state, vessels, currentVesselId: vessel.id };
      persist(next);
      return next;
    }

    case 'update-vessel': {
      const vessels = state.vessels.map((v) =>
        v.id === action.id ? { ...v, ...action.patch, updatedAt: Date.now() } : v);
      const next = { ...state, vessels };
      persist(next);
      return next;
    }

    case 'delete-vessel': {
      const vessels = state.vessels.filter((v) => v.id !== action.id);
      const next = {
        ...state,
        vessels,
        currentVesselId: state.currentVesselId === action.id ? (vessels[0]?.id ?? null) : state.currentVesselId,
      };
      persist(next);
      return next;
    }

    case 'copy-nodes':
      return { ...state, clipboard: JSON.parse(JSON.stringify(action.nodes)) };

    case 'paste-nodes': {
      if (!state.clipboard || !currentMaterial(state)) return state;
      const copies = cloneNodes(state.clipboard);
      const mat = currentMaterial(state)!;
      const graph: Material['graph'] = { nodes: [...mat.graph.nodes, ...copies] };
      const next = { ...withHistory(state, graph), selectedNodeId: copies[0]?.id ?? null };
      persist(next);
      return next;
    }

    case 'import-bundle': {
      const incomingMats = action.bundle.materials.map((m) => ({
        ...m,
        id: action.merge ? uid('mat') : m.id,
      }));
      const incomingVessels = action.bundle.vessels.map((v) => ({
        ...v,
        id: action.merge ? uid('vessel') : v.id,
      }));
      const materials = action.merge
        ? [...state.materials, ...incomingMats]
        : [...state.materials.filter((m) => !incomingMats.some((x) => x.id === m.id)), ...incomingMats];
      const vessels = action.merge
        ? [...state.vessels, ...incomingVessels]
        : [...state.vessels.filter((v) => !incomingVessels.some((x) => x.id === v.id)), ...incomingVessels];
      const next: State = {
        ...state, materials, vessels,
        currentMaterialId: incomingMats[0]?.id ?? state.currentMaterialId,
        currentVesselId: incomingVessels[0]?.id ?? state.currentVesselId,
        past: [], future: [],
      };
      persist(next);
      return next;
    }

    case 'toast':
      return { ...state, toast: action.message };

    default:
      return state;
  }
}

function init(): State {
  const materials = loadMaterials();
  const vessels = loadVessels();
  const settings = loadSettings(DEFAULT_SETTINGS);
  const cur = loadCurrent();
  return {
    page: 'library',
    materials,
    vessels,
    currentMaterialId: cur.materialId && materials.some((m) => m.id === cur.materialId)
      ? cur.materialId : (materials[0]?.id ?? null),
    currentVesselId: cur.vesselId && vessels.some((v) => v.id === cur.vesselId)
      ? cur.vesselId : (vessels[0]?.id ?? null),
    settings,
    selectedNodeId: null,
    past: [],
    future: [],
    clipboard: null,
    toast: null,
  };
}

interface Store {
  state: State;
  dispatch: React.Dispatch<Action>;
  /** 直接替换当前材质 graph（内部自动压栈） */
  commitGraph: (graph: Material['graph']) => void;
  currentMaterial: Material | undefined;
  currentVessel: Vessel | undefined;
  notify: (msg: string) => void;
  exportJSON: () => string;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const toastTimer = useRef<number | null>(null);

  const commitGraph = useCallback((graph: Material['graph']) => {
    dispatch({ type: 'graph-snapshot', graph });
  }, []);

  const notify = useCallback((message: string) => {
    dispatch({ type: 'toast', message });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => dispatch({ type: 'toast', message: null }), 2600);
  }, []);

  const value = useMemo<Store>(() => ({
    state,
    dispatch,
    commitGraph,
    currentMaterial: state.materials.find((m) => m.id === state.currentMaterialId),
    currentVessel: state.vessels.find((v) => v.id === state.currentVesselId),
    notify,
    exportJSON: () => exportBundle(state.materials, state.vessels),
  }), [state, commitGraph, notify]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用');
  return ctx;
}

export { parseBundle };
