// 器型预设：碗、瓶、盘
import type { ProfilePoint, Vessel } from '../types';

function makeVessel(name: string, profile: ProfilePoint[]): Vessel {
  return {
    id: `vessel-${name}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    profile,
    radialSegments: 96,
    heightSegments: 160,
    updatedAt: Date.now(),
  };
}

export const VESSEL_PRESETS: { label: string; build: () => Vessel }[] = [
  {
    label: '碗',
    build: () => makeVessel('碗', [
      { r: 0.0, y: 0.0 },
      { r: 0.22, y: 0.0 },
      { r: 0.3, y: 0.05 },
      { r: 0.42, y: 0.22 },
      { r: 0.52, y: 0.42 },
      { r: 0.55, y: 0.5 },
    ]),
  },
  {
    label: '梅瓶',
    build: () => makeVessel('梅瓶', [
      { r: 0.0, y: 0.0 },
      { r: 0.26, y: 0.02 },
      { r: 0.4, y: 0.15 },
      { r: 0.44, y: 0.4 },
      { r: 0.36, y: 0.65 },
      { r: 0.16, y: 0.85 },
      { r: 0.13, y: 1.0 },
      { r: 0.17, y: 1.05 },
    ]),
  },
  {
    label: '盘',
    build: () => makeVessel('盘', [
      { r: 0.0, y: 0.0 },
      { r: 0.35, y: 0.0 },
      { r: 0.55, y: 0.02 },
      { r: 0.68, y: 0.06 },
      { r: 0.72, y: 0.1 },
    ]),
  },
  {
    label: '玉壶春瓶',
    build: () => makeVessel('玉壶春瓶', [
      { r: 0.0, y: 0.0 },
      { r: 0.24, y: 0.02 },
      { r: 0.38, y: 0.12 },
      { r: 0.4, y: 0.35 },
      { r: 0.3, y: 0.55 },
      { r: 0.14, y: 0.72 },
      { r: 0.12, y: 0.95 },
      { r: 0.16, y: 1.0 },
    ]),
  },
];
