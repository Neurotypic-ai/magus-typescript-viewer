# Graph UX Recovery — Final Merged Plan (v3.1)

## Context

A Codex implementation introduced 12 UI/UX regressions. This plan merges the best of three prior plans (Opus v1, Codex v2, Codex v3) while correcting architectural errors found through:

- **Playwright MCP analysis** of the live app at `localhost:4000`
- **Three targeted codebase explorations** (edge rendering, input classification, compact mode architecture)
- **Architectural constraint discovery**: class/interface nodes MUST remain VueFlow nodes in all modes

### Key Architectural Constraints

1. **Edge color root cause**: Global CSS `!important` in `src/index.css:146`, NOT edge type `step` vs `smoothstep`
2. **Compact mode**: Class/interface nodes ALWAYS stay as VueFlow nodes. Removing them breaks selection, focus, isolation, drilldown, keyboard nav, edges, search, and minimap (8+ interaction paths verified)
3. **`memberNodeMode`**: Existing name is fine — controls member (property/method) rendering only. No rename needed.
4. **Mac input**: VueFlow's `panOnScroll=true` processes events before custom handlers — need to disable VueFlow's built-in and use `@pane-scroll` + `panBy()`/`zoomTo()` APIs

### What's Incorporated From Codex v3

- Phase 0 baseline verification with MCP
- Wheel intent classifier as separate utility
- CollapsibleSection.vue as shared component
- Expanded test coverage
- Panel collision awareness
- Workstream format for parallel execution

### What's Rejected From Codex v3

- `symbolRenderMode` rename (unnecessary migration, `memberNodeMode` works)
- Embedding class/interface in modules in compact mode (breaks everything)
- Missing CSS `!important` root cause identification
- `pan-on-scroll=true` on Mac (VueFlow intercepts events first)

---

## Issue Status

| # | Issue | Workstream | Status |
|---|-------|-----------|--------|
| 1 | Methods/Properties toggleable | WS-C | Planned |
| 2 | Methods/Properties in collapsible sections | WS-C | Planned |
| 3 | Compact/graph mode for members | WS-C | Planned (label only) |
| 4 | Orphan highlighting broken | WS-B | Planned |
| 5 | Mini-map viewport indicator | WS-D | Planned |
| 6 | Mini-map proportional sizing | WS-D | Planned |
| 7 | Edge colors not visible | WS-A | Planned |
| 8 | Edges under module nodes | WS-A | Planned |
| 9 | Nodes over detail panel | WS-E | Planned |
| 10 | Zoom +/- controls | N/A | **ALREADY RESOLVED** |
| 11 | Mac scroll/trackpad/pinch | WS-F | Planned |
| 12 | Node type colors | WS-A | Planned |

---

## Phase 0: Baseline Verification

Before any code changes, capture current state via Playwright MCP at `localhost:4000`:

1. Screenshot overview graph — document all 302 edges same color
2. Verify 0 implements/inheritance edges identifiable
3. Verify 0 orphan-highlighted nodes
4. Verify minimap has 0 viewport rectangles
5. Verify all nodes same olive/dark color
6. Verify NodeDetails overlapped by nodes
7. Document zoom +/- already working (Issue 10 resolved)

This baseline is used for regression comparison after each workstream.

---

## Parallel Workstream Architecture

```
Phase 0 (baseline) ──────────────────────────────────────
         │
         ├── WS-A: CSS/Visual Foundation (Issues 7, 8, 12)
         ├── WS-B: Orphan Highlighting (Issue 4)
         ├── WS-C: Collapsible UI (Issues 1, 2, 3)
         ├── WS-D: Minimap Viewport (Issues 5, 6)
         └── WS-E: Panel Layering (Issue 9)
                    │
                    ▼  (all above complete)
              WS-F: Mac Input (Issue 11)  ← depends on WS-A (same file)
                    │
                    ▼
              WS-G: Tests & Verification
```

**WS-A through WS-E are fully independent** — they touch different files with no overlapping edits (except WS-A and WS-F share `index.vue`, resolved by sequencing WS-F after WS-A).

---

## WS-A: CSS & Visual Foundation (Issues 7, 8, 12)

**Agent scope:** 3 files, ~50 lines changed. No behavioral changes.

### A1. Fix edge colors (Issue 7)

**Root cause:** `src/index.css:146`:

```css
.vue-flow__edge-path {
  stroke: rgba(255, 255, 255, 0.3) !important;  /* kills ALL per-edge colors */
}
```

**File: `src/index.css`**

- Line 146: **Delete** the `stroke: rgba(255, 255, 255, 0.3) !important;` line
- Keep `stroke-width: 1.5px !important;`, `cursor: pointer`, `transition`
- Keep hover rules (lines 152-155) and selected rules (lines 162-164) — intentional interaction overrides

**File: `src/client/components/DependencyGraph/index.vue`**

- Lines 693-698: Remove `style: { stroke: '#61dafb', strokeWidth: 3 }` from `default-edge-options`
- Change `type: 'step'` to `type: 'smoothstep'` (smoother curves)
- Set default `zIndex: 2` (matches stratified layer)
- Result:

```javascript
:default-edge-options="{
  markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
  zIndex: 2,
  type: 'smoothstep',
}"
```

**Expected:** Import=cyan `#61dafb`, inheritance=green `#4caf50`, implements=orange `#ff9800`

### A2. Stratified z-index layering (Issue 8)

| Layer | z-index | Elements |
|-------|---------|----------|
| Bottom | 0 | Package nodes |
| Low | 1 | Module nodes |
| **Middle** | **2** | **Edge SVG container** |
| High | 3 | Class/Interface nodes |
| Top | 4 | Member nodes |
| Boosted | 5 | Isolated connected edges |

**File: `src/index.css`** — Add after line 143:

```css
.vue-flow__edges {
  z-index: 2;
  position: relative;
}
```

**File: `src/client/utils/createGraphNodes.ts`**

- Line 458 (class): `zIndex: 2` -> `zIndex: 3`
- Line 562 (interface): `zIndex: 2` -> `zIndex: 3`
- Line 113 (members): `zIndex: 3` -> `zIndex: 4`
- Lines 300, 381 (package/module): keep 0, 1

**File: `src/client/components/DependencyGraph/nodes/SymbolNode.vue`** — Line 59:

- `zIndex: isMemberNode.value ? 3 : 2` -> `zIndex: isMemberNode.value ? 4 : 3`

**File: `src/client/components/DependencyGraph/index.vue`** — Line 412:

- Isolated connected edge zIndex: `4` -> `5`

### A3. Node type color differentiation (Issue 12)

**File: `src/client/theme/graphTheme.ts`** — Update `getNodeStyle()` (lines 142-202):

| Type | Background | Border |
|------|-----------|--------|
| Module | `rgba(59, 130, 246, 0.06)` | `rgba(59, 130, 246, 0.25)` |
| Class | `rgba(59, 130, 246, 0.10)` | `rgba(59, 130, 246, 0.35)` |
| Interface | `rgba(168, 85, 247, 0.10)` | `rgba(168, 85, 247, 0.35)` |
| Package | `rgba(20, 184, 166, 0.08)` | `rgba(20, 184, 166, 0.3)` |

Verify minimap `nodeFill()` in `GraphMiniMap.vue` aligns (already has per-type tints).

### WS-A Files Touched

- `src/index.css`
- `src/client/components/DependencyGraph/index.vue` (lines 412, 693-698)
- `src/client/utils/createGraphNodes.ts` (lines 113, 458, 562)
- `src/client/components/DependencyGraph/nodes/SymbolNode.vue` (line 59)
- `src/client/theme/graphTheme.ts` (lines 142-202)

---

## WS-B: Orphan Highlighting Rework (Issue 4)

**Agent scope:** 5 files, ~60 lines changed. Removes broken feature, simplifies to global-only.

### B1. Settings simplification

**File: `src/client/stores/graphSettings.ts`**

- Remove `highlightOrphanCurrent` ref, setter, and persistence handling
- Keep `highlightOrphanGlobal`
- Remove from `PersistedGraphSettings` interface

### B2. Controls simplification

**File: `src/client/components/DependencyGraph/components/GraphControls.vue`**

- Remove "Highlight current-view orphans" checkbox
- Remove `@toggle-orphan-current` emit
- Keep "Highlight global orphans" checkbox

### B3. Fix visual application layer

**File: `src/client/components/DependencyGraph/buildGraphView.ts`**

- Remove `highlightOrphanCurrent` from `BuildOverviewGraphOptions`
- Remove `applyOrphanHighlightStyling()` function entirely (it applies styles to wrong DOM layer)
- Keep `annotateOrphanDiagnostics()` — correctly sets `data.diagnostics.orphanGlobal` flags

### B4. Wiring cleanup

**File: `src/client/components/DependencyGraph/index.vue`**

- Remove `handleOrphanCurrentToggle` handler
- Remove `@toggle-orphan-current` binding on `<GraphControls>`
- Remove `highlightOrphanCurrent` from `buildOverviewGraph()` call options

### B5. Visual via CSS class on inner container

**File: `src/client/components/DependencyGraph/nodes/BaseNode.vue`**

- Add computed:

```typescript
const isOrphanGlobal = computed(() => {
  const diag = nodeData.value?.diagnostics as { orphanGlobal?: boolean } | undefined;
  return diag?.orphanGlobal === true;
});
```

- Add CSS class to `.base-node-container`: `'base-node-orphan-global': isOrphanGlobal`
- Add scoped CSS (using `outline` to avoid dimension shifts):

```css
.base-node-container.base-node-orphan-global {
  outline: 2px solid #ef4444;
  outline-offset: -1px;
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.45);
}
```

### WS-B Files Touched

- `src/client/stores/graphSettings.ts`
- `src/client/components/DependencyGraph/components/GraphControls.vue`
- `src/client/components/DependencyGraph/buildGraphView.ts`
- `src/client/components/DependencyGraph/index.vue` (orphan handler removal only — no conflict with WS-A's edge/z-index edits)
- `src/client/components/DependencyGraph/nodes/BaseNode.vue`

---

## WS-C: Collapsible Content UI (Issues 1, 2, 3)

**Agent scope:** 3 files (1 new), ~150 lines. Restores collapsible member sections.

### C1. Create CollapsibleSection component

**New file: `src/client/components/DependencyGraph/nodes/CollapsibleSection.vue`**

- Props: `title: string`, `count: number`, `defaultOpen?: boolean`
- Uses Vue `<Transition name="section-collapse">` for animation
- Toggle button with +/- indicator, `@click.stop` to prevent node selection
- Slot for content
- Follow `ModuleNode.vue`'s existing `.module-section-toggle` style pattern

### C2. Update SymbolNode with collapsible sections

**File: `src/client/components/DependencyGraph/nodes/SymbolNode.vue`**

- Add `ref` state: `showProperties = ref(true)`, `showMethods = ref(true)`
- Replace flat "Members: X properties * Y methods" summary (lines 93-98) with:
  - **Properties (N)** collapsible section — lists `visibility name: type` in monospace
  - **Methods (N)** collapsible section — lists `visibility name(): returnType`
- Hide section when count = 0
- Default: expanded
- Use `CollapsibleSection` component from C1

### C3. Clarify compact/graph toggle labels

**File: `src/client/components/DependencyGraph/components/GraphControls.vue`**

- Rename section: "Member Nodes" -> "Member Display"
- Rename buttons: "Compact" -> "Inline", "Graph" -> "Separate Nodes"
- Add description text: "How properties and methods render within class/interface nodes"

**Architectural note:** Class/interface nodes remain VueFlow nodes in BOTH modes. The toggle only controls member rendering:

- **Inline (compact):** Members as collapsible text sections inside class/interface cards
- **Separate Nodes (graph):** Members as individual VueFlow child nodes

### WS-C Files Touched

- `src/client/components/DependencyGraph/nodes/CollapsibleSection.vue` (NEW)
- `src/client/components/DependencyGraph/nodes/SymbolNode.vue` (lines 93-98 replacement)
- `src/client/components/DependencyGraph/components/GraphControls.vue` (label changes only — no conflict with WS-B's checkbox removal)

---

## WS-D: Minimap Viewport & Proportional Sizing (Issues 5, 6)

**Agent scope:** 1 file, ~100 lines added. Self-contained.

### D1. Viewport indicator rectangle

**File: `src/client/components/DependencyGraph/components/GraphMiniMap.vue`**

**Existing code to reuse:** `viewport` from `useVueFlow()` (line 16), `toGraphPosition()` (line 140), `mapScale` (line 73), `nodeBounds` (line 38), `setCenter` (line 16).

Add viewport rectangle computation:

```typescript
const viewportRect = computed(() => {
  const vp = viewport.value;
  const containerEl = document.querySelector('.vue-flow') as HTMLElement | null;
  const cw = containerEl?.clientWidth ?? window.innerWidth;
  const ch = containerEl?.clientHeight ?? window.innerHeight;
  const scale = mapScale.value;

  return {
    x: (-vp.x / vp.zoom - nodeBounds.value.minX) * scale + MAP_PADDING,
    y: (-vp.y / vp.zoom - nodeBounds.value.minY) * scale + MAP_PADDING,
    width: (cw / vp.zoom) * scale,
    height: (ch / vp.zoom) * scale,
  };
});
```

Render as cyan dashed rect after nodes/edges in SVG. Add `cursor: grab` styling.

### D2. Draggable viewport

- `mousedown` on viewport rect -> capture offset, add `mousemove`/`mouseup` on `window`
- `mousemove` -> convert minimap coords via `toGraphPosition()` -> `setCenter()` with `duration: 0`
- `mouseup` -> release listeners

### D3. Proportional sizing

Replace fixed `MAP_WIDTH=220` / `MAP_HEIGHT=140` with computed dimensions:

```typescript
const MAX_WIDTH = 220, MAX_HEIGHT = 160, MIN_SIZE = 80;

const mapDimensions = computed(() => {
  const aspect = nodeBounds.value.width / Math.max(1, nodeBounds.value.height);
  if (aspect >= 1) {
    const h = Math.max(MIN_SIZE, Math.round(MAX_WIDTH / aspect));
    return { width: MAX_WIDTH, height: Math.min(MAX_HEIGHT, h) };
  }
  const w = Math.max(MIN_SIZE, Math.round(MAX_HEIGHT * aspect));
  return { width: Math.min(MAX_WIDTH, w), height: MAX_HEIGHT };
});
```

Replace all `MAP_WIDTH`/`MAP_HEIGHT` refs with `mapDimensions.value.width`/`.height`.

### WS-D Files Touched

- `src/client/components/DependencyGraph/components/GraphMiniMap.vue` (self-contained)

---

## WS-E: Panel Layering Fix (Issue 9)

**Agent scope:** 2 files, ~10 lines. Minimal risk.

### E1. Move NodeDetails outside VueFlow

**File: `src/client/components/DependencyGraph/index.vue`**

- Lines 720-727: Move `<NodeDetails>` from inside `<VueFlow>` to **outside** as sibling, after `</VueFlow>`

```html
<div class="dependency-graph-root h-full w-full relative">
  <VueFlow ...>
    <!-- GraphControls, GraphSearch, GraphMiniMap, Panels -->
  </VueFlow>
  <NodeDetails v-if="selectedNode" ... />
</div>
```

### E2. Fix positioning and z-index

**File: `src/client/components/DependencyGraph/components/NodeDetails.vue`**

- Line 360: Change `fixed top-4 right-4` -> `absolute top-14 right-4 z-50`
- `top-14` (3.5rem) positions below GraphSearch panel area
- `z-50` ensures above all graph elements and HUD panels

### WS-E Files Touched

- `src/client/components/DependencyGraph/index.vue` (template move only — different lines than WS-A/WS-B edits)
- `src/client/components/DependencyGraph/components/NodeDetails.vue`

---

## WS-F: Mac Input Handling (Issue 11)

**Depends on: WS-A completion** (shares `index.vue` edits for VueFlow props).

**Agent scope:** 2 files (1 new utility), ~80 lines.

### F1. Wheel intent classifier utility

**New file: `src/client/components/DependencyGraph/utils/wheelIntent.ts`**

```typescript
export type WheelIntent = 'pinch' | 'mouseWheel' | 'trackpadScroll';

export function classifyWheelIntent(event: WheelEvent): WheelIntent {
  // ctrlKey = pinch-to-zoom gesture (Mac Chrome/Safari)
  if (event.ctrlKey) return 'pinch';

  // deltaMode=1 (line-based) = definitely mouse wheel
  if (event.deltaMode !== 0) return 'mouseWheel';

  // deltaMode=0: heuristic classification
  // Trackpads: often have horizontal delta, smaller Y deltas
  // Mouse wheels: Y-only, larger delta magnitudes
  if (Math.abs(event.deltaX) > 0) return 'trackpadScroll';
  if (Math.abs(event.deltaY) < 40) return 'trackpadScroll';

  return 'mouseWheel';
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
}
```

### F2. Custom pane scroll handler

**File: `src/client/components/DependencyGraph/index.vue`**

VueFlow APIs used: `panBy()`, `zoomTo()`, `getViewport()` (from `useVueFlow()`).

**VueFlow props (Mac):**

```
:zoom-on-scroll="!isMac"
:pan-on-scroll="false"
:zoom-on-pinch="true"
```

**Handler:**

```typescript
function handlePaneScroll(event: WheelEvent | undefined): void {
  if (!event || !isMac.value) return;

  const intent = classifyWheelIntent(event);

  if (intent === 'pinch') return; // VueFlow's zoomOnPinch handles it

  if (intent === 'trackpadScroll') {
    panBy({ x: -event.deltaX, y: -event.deltaY });
  } else {
    const zoom = getViewport().zoom;
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    void zoomTo(Math.max(0.1, Math.min(2, zoom * factor)), { duration: 50 });
  }

  event.preventDefault();
}
```

Wire: `@pane-scroll="handlePaneScroll"`

### WS-F Files Touched

- `src/client/components/DependencyGraph/utils/wheelIntent.ts` (NEW)
- `src/client/components/DependencyGraph/index.vue` (VueFlow props + handler)

---

## WS-G: Tests & Final Verification

**Depends on: All workstreams complete.**

### G1. Unit Tests (Vitest)

| Test | File | Workstream |
|------|------|-----------|
| z-index: class=3, interface=3, member=4 | `createGraphNodes.test.ts` | WS-A |
| `getNodeStyle()` returns distinct colors per type | New `graphTheme.test.ts` | WS-A |
| `getEdgeStyle()` returns correct typed colors | New `graphTheme.test.ts` | WS-A |
| `buildOverviewGraph` no `highlightOrphanCurrent` option | `buildGraphView.test.ts` | WS-B |
| `orphanGlobal` data flag set, no `node.style.borderColor` | `buildGraphView.test.ts` | WS-B |
| `classifyWheelIntent` for mouse/trackpad/pinch | New `wheelIntent.test.ts` | WS-F |

### G2. Playwright MCP Verification (at `localhost:4000`)

| # | Issue | Verification |
|---|-------|-------------|
| 7 | Edge colors | Orange implements, green inheritance, cyan import — not all white |
| 8 | Edge layering | Edges above module containers, below class/interface cards |
| 12 | Node colors | Module=blue, class=stronger blue, interface=purple, package=teal |
| 4 | Orphan highlight | "Highlight global orphans" -> red outline glow. No current-view option |
| 9 | Panel overlap | NodeDetails above graph nodes at all zoom levels |
| 1,2 | Collapsible | Class/interface show Properties/Methods collapsible toggles |
| 3 | Mode labels | "Inline"/"Separate Nodes" labels, class/interface exist in both modes |
| 5 | Minimap viewport | Cyan rect on minimap, moves with pan/zoom |
| 6 | Minimap proportional | Minimap aspect matches graph layout |
| 5 | Minimap drag | Dragging viewport rect pans graph |
| 11 | Mac input | Trackpad=pan, mouse wheel=zoom, pinch=zoom |
| 10 | Zoom controls | +/- buttons still work (regression check) |

---

## Agent Assignment for Parallel Execution

### Team Structure

```
Lead Agent (coordinator)
  ├── Agent-A: CSS/Visual (WS-A) ─────── Issues 7, 8, 12
  ├── Agent-B: Orphan Fix (WS-B) ─────── Issue 4
  ├── Agent-C: Collapsible UI (WS-C) ──── Issues 1, 2, 3
  ├── Agent-D: Minimap (WS-D) ──────── Issues 5, 6
  └── Agent-E: Panel Fix (WS-E) ─────── Issue 9
       │
       ▼ (after WS-A completes)
  Agent-F: Mac Input (WS-F) ──────── Issue 11
       │
       ▼ (after all complete)
  Agent-G: Tests & Verify (WS-G) ──── All issues
```

### Conflict Matrix

| | index.vue | index.css | createGraphNodes.ts | graphTheme.ts | SymbolNode.vue | BaseNode.vue | GraphControls.vue | GraphMiniMap.vue | NodeDetails.vue | buildGraphView.ts | graphSettings.ts |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **WS-A** | lines 412,693 | lines 143,146 | lines 113,458,562 | lines 142-202 | line 59 | | | | | | |
| **WS-B** | orphan handler | | | | | orphan CSS | checkbox | | | orphan fn | setting |
| **WS-C** | | | | | lines 93-98 | | labels | | | | |
| **WS-D** | | | | | | | | ALL | | | |
| **WS-E** | line 720 move | | | | | | | | line 360 | | |
| **WS-F** | props+handler | | | | | | | | | | |

**No conflicts between WS-A through WS-E** — they edit different lines in shared files or different files entirely.

**WS-F conflicts with WS-A** on `index.vue` VueFlow props — must run after WS-A.

### Agent Instructions Summary

Each agent receives:

1. Their workstream section from this plan
2. The conflict matrix showing which lines they own
3. Instruction to run `pnpm test` after their changes
4. Instruction to NOT touch lines owned by other workstreams

---

## First Implementation Step

When plan is approved, before any code changes:

1. Create `docs/graphfixes/` directory
2. Copy this plan to `docs/graphfixes/plan-v3.1.md`
3. Create `docs/graphfixes/baseline-verification.md` with Phase 0 MCP results
4. Begin parallel workstreams A-E
