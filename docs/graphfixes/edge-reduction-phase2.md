# Phase 2 Edge Reduction Design

## Scope

This phase follows workerized edge virtualization and focuses on reducing raw edge count before render time.

## Option A: Module Superedges (conventional, mature)

- Maturity: high, widely used in large dependency and call-graph UIs.
- Stability for this codebase: high.
- Expected benefit: high for overview mode where many member/import edges collapse into a smaller module-level set.

### Implementation shape

1. Add import-edge aggregation controls in `createGraphEdges`:
   - group by `sourceModuleId + targetModuleId`
   - emit one representative edge with metadata:
     - `bundledCount`
     - `bundledTypes`
     - `importNames` (optional)
2. Keep relationship filtering behavior:
   - superedge visible if any represented edge is visible.
3. Keep drilldown detail:
   - expose grouped edge metadata in `NodeDetails`/tooltips.

### Candidate files

- `src/client/utils/createGraphEdges.ts`
- `src/client/components/DependencyGraph/buildGraphView.ts`
- `src/client/components/DependencyGraph/types.ts`

## Option B: Zoom LOD edge collapsing (conventional, mature)

- Maturity: high.
- Stability for this codebase: medium-high.
- Expected benefit: medium-high at low zoom.

### Implementation shape

1. When zoom is below threshold, apply aggressive bundling for parallel edges.
2. On zoom-in, progressively restore detailed edges.
3. Ensure keyboard and search semantics remain stable regardless of LOD.

### Candidate files

- `src/client/components/DependencyGraph/index.vue`
- `src/client/components/DependencyGraph/buildGraphView.ts`

## Option C: Hidden hub reroute prototype (novel, experimental)

- Maturity: medium in research literature, experimental in this codebase.
- Stability for this codebase: medium-low.
- Expected benefit: visual decluttering for high fan-in/fan-out modules.

### Critical caveat

If a Vue Flow node is marked `hidden`, connected edges can also become hidden. The prototype must therefore:

1. Inject temporary hub nodes before layout.
2. Run layout using those hub nodes.
3. Rewrite output to direct visual edges with optional waypoints.
4. Drop hub nodes before render.

### Candidate files

- `src/client/components/DependencyGraph/buildGraphView.ts`
- `src/client/workers/GraphLayoutWorker.ts`
- `src/client/components/DependencyGraph/components/CanvasEdgeLayer.vue`

## Accessibility constraints (WCAG-oriented)

- Preserve visible focus and selected-state contrast for nodes and highlighted edges.
- Never make detail discoverability pointer-only; maintain keyboard path to edge metadata.
- Preserve readable labels and avoid relying on color alone when showing aggregated edges.

## Recommended order

1. Module superedges (lowest risk, highest immediate payoff).
2. Zoom LOD collapse/reveal.
3. Hidden hub reroute prototype behind an explicit experimental flag.
