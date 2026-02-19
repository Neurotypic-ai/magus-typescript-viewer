# Plan: Obstacle-Aware Intra-Folder Edge Routing (Merged Canonical)

## Goal

Implement obstacle-aware intra-folder edge routing in Folder View so edges avoid unconnected sibling nodes while keeping runtime bounded, debuggable, and rollback-safe.

## Context

The Folder View strategy (`folderDistributor`) supports optional intra-folder edges (gated by `showIntraFolderEdges`). These edges currently use Vue Flow `smoothstep` with a 20px offset, which avoids source/target clipping but does not route around intermediate unconnected nodes.

## Non-Negotiable Invariants

1. Rendered path starts exactly at `sourceX/sourceY`.
2. Rendered path ends exactly at `targetX/targetY`.
3. Rendered path must not intersect unconnected sibling node rectangles.
4. Routing compute must stay within explicit hard caps.

## Coordinate System Contract

All routing coordinates use Vue Flow absolute space:

- `EdgeProps.sourceX/Y`, `targetX/Y`: absolute handle positions from Vue Flow
- `GraphNode.computedPosition`: absolute node top-left
- `GraphNode.dimensions`: `{ width, height }` measured by Vue Flow
- Never use `node.position` for obstacle geometry (`node.position` is parent-relative)

## Architecture Overview

```text
EdgeProps (sourceX/Y, targetX/Y, sourceNode, targetNode)
  |
  v
DependencyGraph.vue
  | registers edgeTypes.intraFolder
  | provides shared folder obstacle index + runtime options
  |
  v
IntraFolderEdge.vue (custom edge component)
  | resolve folder snapshot, exclude source/target obstacles
  | cache key: edgeId + folderVersion + quantized endpoints + optionsVersion
  |
  v
findObstacleAwarePath(source, target, obstacles, options)
  | returns { path|null, labelPoint|null, status, metrics }
  |
  +-- path safe -> <BaseEdge :path="..." />
  +-- no safe path (obstacle-aware mode) -> do not render edge
  +-- rollback mode -> smoothstep fallback
```

## Runtime Policy

### Obstacle-Aware Mode (default)

1. Attempt bounded A* route.
2. Render only when a safe route is available.
3. If status is `no-route`, `grid-cap-exceeded`, or `not-measured`, do not render that edge.

### Emergency Rollback Mode

When `VITE_OBSTACLE_AWARE_INTRA_FOLDER_EDGES=false`:

- use `smoothstep` behavior for operational recovery
- this is best-effort and does not guarantee non-intersection

## File Changes

### 1. `src/client/layout/orthogonalPathfinder.ts` (New)

Pure function utility with no Vue/reactive dependencies.

```typescript
export interface ObstacleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PathfinderOptions {
  // Original defaults were: obstaclePadding 8, gridMargin 30, cornerRadius 8.
  // Hardened defaults below reduce corner-overlap risk and add hard caps.
  gridResolution?: number;   // default: 10 (px per cell)
  obstaclePadding?: number;  // default: 10
  gridMargin?: number;       // default: 36
  cornerRadius?: number;     // default: 6
  maxGridCells?: number;     // default: 12000
  maxVisitedCells?: number;  // default: 30000
}

export type PathStatus =
  | 'ok'
  | 'invalid-input'
  | 'not-measured'
  | 'no-route'
  | 'grid-cap-exceeded';

export interface ObstacleAwarePathResult {
  path: string | null;
  labelPoint: { x: number; y: number } | null;
  status: PathStatus;
  visitedCells: number;
  gridCellCount: number;
}

export function findObstacleAwarePath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  obstacles: ObstacleRect[],
  options?: PathfinderOptions
): ObstacleAwarePathResult;
```

Algorithm steps:

1. Validate finite inputs; reject invalid coordinates.
2. Compute AABB containing source, target, and obstacles.
3. Expand by `gridMargin`.
4. Estimate grid size and enforce `maxGridCells` (single coarsening retry allowed).
5. Build occupancy grid (`Uint8Array`) and inflate obstacles by `obstaclePadding`.
6. Force-clear source/target cells.
7. Run 4-directional A* with Manhattan heuristic and straight-direction tie-breaking.
8. Simplify collinear points.
9. Map to world points and force exact endpoint anchors.
10. Round corners with `buildRoundedPolylinePath`.
11. Validate rounded path against non-inflated obstacles; if intersection occurs, retry with `cornerRadius=0`.
12. Return `ObstacleAwarePathResult` with status and metrics.

SVG serialization helper retained from original approach:

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

A* implementation detail retained from original: use a binary min-heap priority queue keyed by `f = g + h`.

### 2. `src/client/composables/useIntraFolderObstacleIndex.ts` (New)

Shared folder obstacle snapshots to avoid per-edge full-node scans.

```typescript
export interface FolderObstacleSnapshot {
  folderId: string;
  ready: boolean;
  version: string; // deterministic hash from same-folder geometry only
  obstacles: Array<ObstacleRect & { nodeId: string }>;
}

export interface IntraFolderObstacleIndex {
  getSnapshot(folderId: string): FolderObstacleSnapshot | null;
}
```

Behavior:

- group nodes by `parentNode`
- null-safe guards around `dimensions` and `computedPosition`
- snapshot `ready=false` when relevant geometry is unmeasured
- unrelated-folder updates do not change a folder snapshot version

### 3. `src/client/components/edges/IntraFolderEdge.vue` (New)

Canonical merged responsibilities:

- guard `sourceNode`, `targetNode`, `parentNode`, `dimensions`, `computedPosition`
- resolve folder snapshot from shared index
- remove source/target nodes from obstacle set
- use route cache key:
  - `edgeId + folderVersion + quantized(source,target) + optionsVersion`
- use path-derived label point (not straight midpoint)
- enforce runtime policy:
  - obstacle-aware mode: render only safe path
  - rollback mode: use smoothstep fallback

Design notes preserved from the original plan:

- keep obstacle gathering and route computation as separate steps for clearer invalidation behavior
- guard out unmeasured zero-dimension nodes on first pass to avoid unstable geometry
- pass through `interactionWidth` for consistent hover/click targeting

Reference merged snippet:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@vue-flow/core';
import { findObstacleAwarePath } from '../../layout/orthogonalPathfinder';
import { useIntraFolderObstacleIndex } from '../../composables/useIntraFolderObstacleIndex';

const props = defineProps<EdgeProps>();
const obstacleIndex = useIntraFolderObstacleIndex();
const enableObstacleAware = true; // provided by graph runtime/env wiring

const routeResult = computed(() => {
  const folderId = props.sourceNode?.parentNode ?? props.targetNode?.parentNode;
  if (!folderId) return { path: null, labelX: undefined, labelY: undefined, status: 'not-measured' as const };

  const snapshot = obstacleIndex.getSnapshot(folderId);
  if (!snapshot || !snapshot.ready) {
    return { path: null, labelX: undefined, labelY: undefined, status: 'not-measured' as const };
  }

  const source = { x: props.sourceX, y: props.sourceY };
  const target = { x: props.targetX, y: props.targetY };
  const obstacles = snapshot.obstacles
    .filter((o) => o.nodeId !== props.source && o.nodeId !== props.target)
    .map(({ nodeId: _nodeId, ...rect }) => rect);
  const result = findObstacleAwarePath(source, target, obstacles);

  if (result.path) {
    return {
      path: result.path,
      labelX: result.labelPoint?.x,
      labelY: result.labelPoint?.y,
      status: result.status,
    };
  }

  if (!enableObstacleAware) {
    const [path, labelX, labelY] = getSmoothStepPath({
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      targetX: props.targetX,
      targetY: props.targetY,
      sourcePosition: props.sourcePosition,
      targetPosition: props.targetPosition,
      offset: 20,
      borderRadius: 8,
    });
    return { path, labelX, labelY, status: 'no-route' as const };
  }

  return { path: null, labelX: undefined, labelY: undefined, status: result.status };
});
</script>

<template>
  <BaseEdge
    v-if="routeResult.path"
    :id="id"
    :path="routeResult.path"
    :label-x="routeResult.labelX"
    :label-y="routeResult.labelY"
    :marker-start="markerStart"
    :marker-end="markerEnd"
    :style="style"
    :interaction-width="interactionWidth"
  />
</template>
```

### 4. `src/client/components/DependencyGraph.vue` (Modify)

Register edge type (retained from original) and wire runtime context.

```typescript
import IntraFolderEdge from './edges/IntraFolderEdge.vue';

const edgeTypes: Record<string, Component> = Object.freeze({
  intraFolder: IntraFolderEdge,
});
```

Template wiring retained:

```vue
<VueFlow
  :nodes="visualNodes"
  :edges="renderedEdges"
  :node-types="nodeTypes as any"
  :edge-types="edgeTypes as any"
  ...
```

Additional runtime wiring:

- provide shared obstacle index
- read `VITE_OBSTACLE_AWARE_INTRA_FOLDER_EDGES` (default `true`)
- pass routing options/caps through provider/composable context
- preserve existing `as any` pattern for `edge-types` (same rationale as `node-types` under `exactOptionalPropertyTypes`)

### 5. `src/client/graph/buildFolderDistributorGraph.ts` (Modify)

Retained from original intent:

- change `type: 'smoothstep' as const` -> `type: 'intraFolder' as const`
- remove builder-level `pathOptions` for intra-folder edges
- keep `applyEdgeVisibility` and `bundleParallelEdges` flow

Pipeline snippet retained:

```typescript
const routedEdges = intraEdges.map((edge) => ({
  ...edge,
  type: 'intraFolder' as const,
}));
```

Bundling note retained: representative edge inherits `type: 'intraFolder'`.

### 6. `src/client/rendering/strategyRegistry.ts` (No Functional Change)

- keep `showIntraFolderEdges` default `false` for safe rollout
- rollback uses env kill switch (no new UI toggle required)

## Edge Cases

| Scenario | Behavior | Status / policy |
|---|---|---|
| No obstacles in folder | direct orthogonal route | `ok` |
| Obstacle directly between source and target | route detours orthogonally | `ok` |
| All routes blocked | no edge in obstacle-aware mode; smoothstep only in rollback mode | `no-route` |
| First render before DOM measurement | defer route until snapshot ready | `not-measured` |
| User drags a node | recompute from updated folder snapshot/version | `ok` or bounded fail status |
| Collapsed folder | no intra-folder child edges reach component | n/a |
| Nested folders | edges only for same immediate folder (`buildNodeToFolderMap`) | n/a |
| Group label inset area | not treated as obstacle (labels above content) | n/a |
| Source equals target | builder filters out; utility treats as invalid | `invalid-input` |
| Grid exceeds cap | coarsen once, then fail bounded | `grid-cap-exceeded` |
| Rounded path intersects obstacle | retry with `cornerRadius=0` | `ok` or `no-route` |

## Testing

### Unit Tests: `src/client/layout/__tests__/orthogonalPathfinder.test.ts` (New)

1. no obstacles -> direct route
2. single obstacle between source and target -> detour
3. obstacle on source position -> source cell force-clear works
4. multiple obstacles forming wall -> route around wall ends
5. unreachable target enclosed by obstacles -> `no-route`
6. source equals target -> invalid/trivial contract behavior is deterministic
7. path simplification removes collinear points
8. rounded path produces `Q` segments when applicable
9. tie-breaking favors straighter equal-cost route
10. endpoint anchoring is exact (`sourceX/Y`, `targetX/Y`)
11. rounded intersection fallback to `cornerRadius=0`
12. grid cap behavior returns `grid-cap-exceeded`

### Unit Tests: `src/client/composables/__tests__/useIntraFolderObstacleIndex.test.ts` (New)

1. missing `dimensions/computedPosition` does not throw
2. same-folder version stability for unchanged geometry
3. unrelated-folder updates do not invalidate folder version
4. readiness transitions (`ready=false` -> `true`) after measurement

### Existing Tests Retained

`pnpm vitest run src/client/__tests__/buildFolderDistributorGraph.test.ts` baseline remains part of verification, with added coverage for `showIntraFolderEdges: true`.

### E2E Extension (Recommended)

`tests/e2e/graph-interaction.spec.ts`:

1. switch to Folder View
2. enable "Show intra-folder edges"
3. verify intra-folder edges render for fixture graph
4. move a sibling node and verify reroute behavior

### Manual Verification

1. switch to Folder View and enable intra-folder edges
2. verify detours around intermediate sibling nodes
3. collapse/expand folder and verify edge lifecycle
4. drag nodes and verify reroute stability
5. toggle relationship filters and verify visibility semantics
6. toggle rollback env switch and verify smoothstep recovery mode

## Observability and Acceptance Criteria

Telemetry:

- route attempts by status (`ok`, `no-route`, `grid-cap-exceeded`, `not-measured`, `invalid-input`)
- route compute duration histogram
- throttled warnings for repeated failures by edge id

Acceptance thresholds:

- p95 route compute <= 6 ms for folders up to 25 sibling nodes
- fallback statuses (`no-route` + `grid-cap-exceeded`) < 1% on representative projects

## Accessibility (WCAG)

- no new non-keyboard controls
- non-rendered unsafe edges remain non-focusable/non-interactive
- no flashing or animation regressions from routing logic

## Files Summary

| File | Action | Purpose |
|---|---|---|
| `src/client/layout/orthogonalPathfinder.ts` | New | bounded A* router + status/metrics |
| `src/client/composables/useIntraFolderObstacleIndex.ts` | New | shared folder obstacle snapshots/versioning |
| `src/client/components/edges/IntraFolderEdge.vue` | New | custom safe intra-folder edge renderer |
| `src/client/components/DependencyGraph.vue` | Modify | register `edgeTypes` + provide routing context |
| `src/client/graph/buildFolderDistributorGraph.ts` | Modify | mark intra-folder edges as `type: 'intraFolder'` |
| `src/client/rendering/strategyRegistry.ts` | No functional change | keep feature default safe/off by UI |
| `src/client/__tests__/buildFolderDistributorGraph.test.ts` | Modify | intra-folder edge pipeline coverage |
| `src/client/layout/__tests__/orthogonalPathfinder.test.ts` | New | pathfinder correctness and bounded behavior |
| `src/client/composables/__tests__/useIntraFolderObstacleIndex.test.ts` | New | obstacle index guard/versioning tests |

## Reused Existing Code

- `buildRoundedPolylinePath()` in `src/client/layout/edgeGeometryPolicy.ts`
- `buildNodeToFolderMap()` in `src/client/graph/cluster/folderMembership.ts`
- `applyEdgeVisibility()` in `src/client/graph/graphViewShared.ts`
- `bundleParallelEdges()` in `src/client/graph/graphViewShared.ts`

## Stability and Maturity

- Chosen approach: bounded grid A* + shared index + cache
  - maturity: high (conventional)
  - risk profile: low novelty, predictable rollout
- Deferred alternative: visibility graph + funnel smoothing
  - maturity in this codebase: medium/novel
  - potential upside: cleaner routing for very dense folders
  - deferred until profiling shows sustained bottleneck

## Appendix: Superseded Details (Preserved for Traceability)

1. Prior fallback policy:
   - original proposal rendered `smoothstep` when no path was found
   - superseded by safe-only rendering in obstacle-aware mode
2. Prior obstacle collection approach:
   - original proposal computed obstacles per edge via full `getNodes`
   - superseded by shared folder obstacle index
3. Prior default tuning:
   - original defaults: `obstaclePadding=8`, `gridMargin=30`, `cornerRadius=8`
   - hardened defaults adjust safety/performance envelope and add hard caps
