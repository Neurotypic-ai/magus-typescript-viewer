import { GROUP_EXCLUSION_ZONE_PX } from './edgeGeometryPolicy';

/** Shared layout spacing constants — single source of truth for worker and collision resolver. */
export const MODULE_PADDING = { horizontal: 48, top: 120, bottom: 48 } as const;
export const GROUP_PADDING = {
  horizontal: GROUP_EXCLUSION_ZONE_PX as unknown as number,
  top: GROUP_EXCLUSION_ZONE_PX as unknown as number,
  bottom: GROUP_EXCLUSION_ZONE_PX as unknown as number,
} as const;
export const OVERLAP_GAP = 40;
