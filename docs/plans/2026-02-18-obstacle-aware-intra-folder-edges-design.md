# Plan: Obstacle-Aware Intra-Folder Edge Routing

## Context

The Folder View strategy (`folderDistributor`) now supports optional intra-folder edges — edges between nodes within the same folder group — gated by a `showIntraFolderEdges` boolean strategy option. These edges currently use Vue Flow's built-in `smoothstep` type with a 20px offset, which prevents clipping through source/target nodes but does **not** route around intermediate (unconnected) nodes that may lie between them. The requirement is that **edges should never visually intersect unconnected nodes**.

This plan adds a custom Vue Flow edge component backed by a grid-based A\* pathfinder that computes orthogonal SVG paths around sibling node bounding boxes at render time.

## Approach: Custom Edge Component + Grid A\* Pathfinding

### Architecture Overview

```text
EdgeProps (sourceX/Y, targetX/Y, sourceNode, targetNode)
  │
  ▼
IntraFolderEdge.vue (custom edge component)
  │  useVueFlow().getNodes → filter same-parentNode siblings
  │  map → obstacle AABBs (computedPosition + dimensions)
  │  guard: skip zero-dimension nodes (unmeasured first pass)
  │
  ▼
findObstacleAwarePath(source, target, obstacles, options)
  │  returns SVG path string | null
  │
  ├─ path found → <BaseEdge :path="svgPath" ... />
  └─ null       → getSmoothStepPath(props) fallback → <BaseEdge ... />
```

### Coordinate System Contract

All coordinates use **Vue Flow absolute space** (`computedPosition`, not `position`):

- `EdgeProps.sourceX/Y`, `targetX/Y` — absolute handle positions computed by Vue Flow
- `GraphNode.computedPosition` — absolute node top-left (parent offsets already resolved)
- `GraphNode.dimensions` — `{ width, height }` from Vue Flow DOM tracking
- **Never use `node.position`** — that is relative to `parentNode`

### File Changes

#### 1. `src/client/layout/orthogonalPathfinder.ts` (New)

Pure function with no Vue/reactive dependencies. Fully unit-testable.

```typescript
export interface ObstacleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PathfinderOptions {
  gridResolution?: number;  // default: 10 (px per cell)
  obstaclePadding?: number; // default: 8 (inflate obstacles by this many px)
  gridMargin?: number;      // default: 30 (px around bounding box)
  cornerRadius?: number;    // default: 8 (quadratic bezier arc radius at bends)
}

export function findObstacleAwarePath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  obstacles: ObstacleRect[],
  options?: PathfinderOptions
): string | null;
```

**Algorithm steps:**

1. **Bounding box**: Compute the AABB encompassing source, target, and all obstacles. Expand by `gridMargin` (default 30px = `2 × obstaclePadding + gridResolution + buffer`). This ensures A\* has room to route around obstacles near the boundary.

2. **Grid construction**: Allocate a `Uint8Array` at `gridResolution` (10px). Mark cells overlapping any obstacle (inflated by `obstaclePadding` = 8px) as blocked. Source and target cells are always unblocked (force-cleared after obstacle marking).

3. **A\* search**: 4-directional movement (up/down/left/right). Manhattan distance heuristic. **Direction-preference tie-breaking**: when two cells have equal `f = g + h`, prefer the cell that continues the current movement direction. This naturally produces straighter paths with fewer bends.

4. **Path simplification**: Walk the raw grid-cell path and remove intermediate points that are collinear (same row or same column as their neighbors). Result: minimal waypoints where direction changes.

5. **Grid-to-world conversion**: Map simplified cell coordinates back to world coordinates.

6. **Corner rounding**: Reuse the existing `buildRoundedPolylinePath()` from [edgeGeometryPolicy.ts](src/client/layout/edgeGeometryPolicy.ts) to convert the polyline into `RoundedPolylinePath` with quadratic bezier arcs at bends. Then serialize to SVG `d`-string:

   ```typescript
   // Reuse from edgeGeometryPolicy.ts:
   import {
     buildRoundedPolylinePath,
     type EdgeGeometryPoint,
     type RoundedPolylinePath,
   } from './edgeGeometryPolicy';
   ```

   SVG serialization (new helper in this file):

   ```typescript
   function roundedPolylineToSvg(rp: RoundedPolylinePath): string {
     let d = `M ${rp.start.x} ${rp.start.y}`;
     for (const seg of rp.segments) {
       if (seg.kind === 'quadratic' && seg.control) {
         d += ` Q ${seg.control.x} ${seg.control.y} ${seg.to.x} ${seg.to.y}`;
       } else {
         d += ` L ${seg.to.x} ${seg.to.y}`;
       }
     }
     return d;
   }
   ```

7. **Return**: SVG path string, or `null` if A\* finds no route.

**A\* implementation detail — priority queue**: For grids this small (~6,000 cells max), use a binary min-heap keyed on `f`-cost. No need for a Fibonacci heap or external library.

#### 2. `src/client/components/edges/IntraFolderEdge.vue` (New)

Custom Vue Flow edge component.

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { BaseEdge, getSmoothStepPath, useVueFlow, type EdgeProps } from '@vue-flow/core';
import { findObstacleAwarePath, type ObstacleRect } from '../../layout/orthogonalPathfinder';

const props = defineProps<EdgeProps>();

const { getNodes } = useVueFlow();

const SMOOTHSTEP_FALLBACK_OPTIONS = { offset: 20, borderRadius: 8 };

/** Filtered sibling obstacle AABBs — only changes when same-folder node positions/sizes change. */
const siblingObstacles = computed<ObstacleRect[]>(() => {
  const parentId = props.sourceNode.parentNode;
  if (!parentId) return [];
  return getNodes.value
    .filter((n) =>
      n.parentNode === parentId
      && n.id !== props.source
      && n.id !== props.target
      && n.dimensions.width > 0   // skip unmeasured nodes
      && n.dimensions.height > 0
    )
    .map((n) => ({
      x: n.computedPosition.x,
      y: n.computedPosition.y,
      width: n.dimensions.width,
      height: n.dimensions.height,
    }));
});

const pathResult = computed(() => {
  const source = { x: props.sourceX, y: props.sourceY };
  const target = { x: props.targetX, y: props.targetY };
  const obstacles = siblingObstacles.value;

  const astarPath = findObstacleAwarePath(source, target, obstacles);
  if (astarPath) {
    // Estimate label position at midpoint
    const midX = (props.sourceX + props.targetX) / 2;
    const midY = (props.sourceY + props.targetY) / 2;
    return { path: astarPath, labelX: midX, labelY: midY };
  }

  // Fallback to smoothstep
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    ...SMOOTHSTEP_FALLBACK_OPTIONS,
  });
  return { path, labelX, labelY };
});
</script>

<template>
  <BaseEdge
    :id="id"
    :path="pathResult.path"
    :label-x="pathResult.labelX"
    :label-y="pathResult.labelY"
    :marker-start="markerStart"
    :marker-end="markerEnd"
    :style="style"
    :interaction-width="interactionWidth"
  />
</template>
```

**Key design decisions:**

- **Two-layer computed**: `siblingObstacles` produces the AABB list, `pathResult` runs the pathfinder. Vue's reactivity tracks that `pathResult` depends on `siblingObstacles` plus `sourceX/Y, targetX/Y`. Changes to nodes in other folders modify `getNodes` but don't change `siblingObstacles` (the filter produces the same result), so Vue skips the pathfinder recomputation.
- **Zero-dimension guard**: Nodes with `dimensions.width === 0` are filtered out of obstacles. During the first render pass before DOM measurement, these are unmeasured. The pathfinder runs with whatever obstacles are measured; the first render may clip but self-corrects after the two-pass measurement completes.
- **Fallback**: Lives in the component, not the utility. The utility returns `string | null`. The component calls `getSmoothStepPath` with the existing `SMOOTHSTEP_FALLBACK_OPTIONS` when `null`.
- **`interactionWidth`**: Passed through to `BaseEdge` for consistent hover/click targeting.

#### 3. `src/client/components/DependencyGraph.vue` (Modify)

Add edge type registration alongside the existing `nodeTypes`:

```typescript
import IntraFolderEdge from './edges/IntraFolderEdge.vue';

const edgeTypes: Record<string, Component> = Object.freeze({
  intraFolder: IntraFolderEdge,
});
```

In the `<VueFlow>` template, add the `:edge-types` prop (after the existing `:node-types`):

```vue
<VueFlow
  :nodes="visualNodes"
  :edges="renderedEdges"
  :node-types="nodeTypes as any"
  :edge-types="edgeTypes as any"
  ...
```

The `as any` cast follows the existing pattern for `nodeTypes` — required due to `exactOptionalPropertyTypes` incompatibility with Vue Flow's prop types.

#### 4. `src/client/graph/buildFolderDistributorGraph.ts` (Modify)

Replace the edge type annotation in the pipeline:

- Change `type: 'smoothstep' as const` → `type: 'intraFolder' as const`
- Remove `pathOptions: INTRA_FOLDER_SMOOTHSTEP_OPTIONS` (pathfinding handles routing internally)
- **Keep** `INTRA_FOLDER_SMOOTHSTEP_OPTIONS` as it's used in the component's smoothstep fallback — actually, move the constant into the edge component where it's consumed. Remove from the builder.

Updated pipeline in `buildFolderDistributorGraph`:

```typescript
const routedEdges = intraEdges.map((edge) => ({
  ...edge,
  type: 'intraFolder' as const,
}));
```

**Bundled edges**: `bundleParallelEdges` creates a representative edge by spreading the first edge in a group. Since we set `type: 'intraFolder'` before bundling, the representative inherits the type. No additional handling needed.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No obstacles in folder (2 nodes only) | A\* finds direct path, no bends needed |
| Obstacle directly between source and target | A\* routes around it orthogonally |
| All routes blocked (theoretically impossible in open folder) | Returns `null` → smoothstep fallback |
| First render before DOM measurement | Zero-dimension nodes excluded from obstacles; first paint may clip, self-corrects after measurement |
| User drags a node | `computedPosition` updates → `siblingObstacles` changes → pathfinder recomputes. No feedback loop — collision resolution and pathfinding are independent (collision repositions nodes, pathfinding reads final positions) |
| Collapsed folder | `collapseFolders()` already removes children and drops intra-folder self-loops; no edges reach the component |
| Nested folders | `filterIntraFolderEdges` uses `buildNodeToFolderMap` which maps to the nearest folder ancestor; edges only connect nodes in the same immediate folder |
| Group label inset area | Not treated as an obstacle — folder labels are above node content area and don't overlap child positions |

## Testing

### Unit Tests: `src/client/layout/__tests__/orthogonalPathfinder.test.ts` (New)

Pure function tests — no Vue/DOM dependencies:

1. **No obstacles** — direct orthogonal path from source to target
2. **Single obstacle between source and target** — path detours around it
3. **Obstacle on source position** — source cell force-cleared, path still found
4. **Multiple obstacles forming a wall** — path routes around the wall ends
5. **Unreachable target** (fully enclosed by obstacles) — returns `null`
6. **Source equals target** — returns trivial `M x y` path or `null`
7. **Path simplification** — verify collinear points removed (e.g., 50 grid cells in a straight line become 2 waypoints)
8. **Corner rounding** — verify SVG string contains `Q` segments at bends
9. **Direction tie-breaking** — verify path with equal-cost alternatives prefers fewer bends

### Existing Tests

`pnpm vitest run src/client/__tests__/buildFolderDistributorGraph.test.ts` — all 7 existing tests pass (the builder change is type-string only).

### Manual Verification

1. Switch to Folder View → enable "Show intra-folder edges"
2. Find a folder with 3+ nodes where an edge skips over an intermediate node
3. Verify the edge routes orthogonally around the intermediate node
4. Collapse that folder → verify edges disappear
5. Expand → verify edges return with correct routing
6. Drag a node → verify edges recompute without visual glitches
7. Toggle relationship type filters → verify edge visibility respects filters

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| [orthogonalPathfinder.ts](src/client/layout/orthogonalPathfinder.ts) | **New** | Grid A\* pathfinder — pure function, no Vue deps |
| [IntraFolderEdge.vue](src/client/components/edges/IntraFolderEdge.vue) | **New** | Custom edge component — obstacle AABB collection + pathfinder call + fallback |
| [DependencyGraph.vue](src/client/components/DependencyGraph.vue) | **Modify** | Register `edgeTypes` with `intraFolder` key |
| [buildFolderDistributorGraph.ts](src/client/graph/buildFolderDistributorGraph.ts) | **Modify** | Set `type: 'intraFolder'`, remove `pathOptions` and smoothstep constant |
| [orthogonalPathfinder.test.ts](src/client/layout/__tests__/orthogonalPathfinder.test.ts) | **New** | Unit tests for pathfinder |

## Reused Existing Code

- [buildRoundedPolylinePath()](src/client/layout/edgeGeometryPolicy.ts) — corner rounding for polyline → SVG conversion
- [buildNodeToFolderMap()](src/client/graph/cluster/folderMembership.ts) — folder membership (used by existing `filterIntraFolderEdges`)
- [applyEdgeVisibility()](src/client/graph/graphViewShared.ts) — relationship type filtering (already in pipeline)
- [bundleParallelEdges()](src/client/graph/graphViewShared.ts) — parallel edge bundling (already in pipeline)
