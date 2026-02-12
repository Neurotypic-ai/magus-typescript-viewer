---
name: vueflow-dedup-alignment
overview:
  Migrate duplicated DependencyGraph functionality onto official Vue Flow plugins where it is low-risk, preserve
  domain-specific behavior where Vue Flow has no equivalent, align custom nodes with internal NodeWrapper semantics,
  harden interaction safety, and eliminate the global CustomEvent antipattern.
todos:
  - id: phase-1-baseline
    content:
      'Phase 1: Write Playwright e2e baseline tests covering wheel/pinch/scroll, minimap, controls, keyboard nav,
      overlay scroll, and focus/isolate actions. Output: test files that pass against current behavior.'
    status: completed
  - id: phase-2-hardening
    content:
      'Phase 2: Add `nodrag` class to all interactive elements in BaseNode/ModuleNode/SymbolNode/GroupNode, add
      `nowheel` to scrollable node regions, fix cursor:move -> cursor:grab, widen DependencyProps, extract shared
      baseNodeProps helper.'
    status: completed
  - id: phase-3-event-refactor
    content:
      'Phase 3: Replace window.dispatchEvent CustomEvent pattern in BaseNode with Vue provide/inject for focus/isolate
      actions.'
    status: completed
  - id: phase-4-controls
    content:
      'Phase 4: Integrate @vue-flow/controls for zoom/fit at bottom-right position, strip zoom buttons from
      GraphControls, audit dormant .vue-flow__controls CSS in index.css, update vite.config.ts flow-vendor chunk.'
    status: completed
  - id: phase-5-minimap-eval
    content:
      'Phase 5: Spike @vue-flow/minimap to evaluate parity with custom GraphMiniMap (type colors, selected highlight,
      viewport drag, click-on-node centering). Document findings. Migrate only if parity confirmed.'
    status: completed
  - id: phase-6-interaction-eval
    content:
      'Phase 6: Test Vue Flow native panOnScroll + zoomOnPinch on macOS against custom wheelIntent behavior. Keep custom
      handler if native fails Mac UX matrix. Remove only confirmed-redundant code.'
    status: completed
  - id: phase-7-toolbar-eval
    content:
      'Phase 7: Spike @vue-flow/node-toolbar for focus/isolate actions. Compare discoverability, keyboard reachability,
      and dense-graph usability against current inline buttons. Adopt only if superior.'
    status: completed
  - id: phase-8-verify
    content:
      'Phase 8: Run Playwright baseline suite, WCAG keyboard/focus audit, and visual regression check. All Phase 1 tests
      must pass. Commit.'
    status: completed
isProject: false
---

# Vue Flow Dedup + NodeWrapper Alignment Plan

## What We Verified

- Custom implementations exist for controls, minimap, and interaction handling:
  - [index.vue](src/client/components/DependencyGraph/index.vue) -- graph root, wheel handling, keyboard nav,
    focus/isolate logic
  - [GraphControls.vue](src/client/components/DependencyGraph/components/GraphControls.vue) -- zoom, fit, layout,
    filters, clustering, analysis toggles
  - [GraphMiniMap.vue](src/client/components/DependencyGraph/components/GraphMiniMap.vue) -- custom SVG minimap (358
    lines) with type colors, selected highlight, viewport drag, click-to-center
- `@vue-flow/controls@1.1.3` is installed but never imported or rendered anywhere. Dormant CSS targeting
  `.vue-flow__controls` exists in [src/index.css](src/index.css) lines 171-193.
- `@vue-flow/minimap` and `@vue-flow/node-toolbar` are **not installed**.
- `NodeWrapper` is an **internal** Vue Flow component. The `.d.ts` file exists at
  `node_modules/@vue-flow/core/dist/components/Nodes/NodeWrapper.d.ts` but is **not** in the package's `exports` map. It
  cannot be imported via normal module resolution and should never be subclassed.
- Custom nodes (BaseNode, ModuleNode, PackageNode, SymbolNode) are rendered **inside** NodeWrapper automatically via
  VueFlow's `node-types` slot mechanism. This is the correct architecture. No inheritance issue exists.
- `GroupNode` bypasses `BaseNode` entirely -- no handles, no action buttons, no `nodrag`/`nowheel` classes.

## NodeWrapper Responsibility Split (Critical Context)

NodeWrapper (internal, per-node) handles:

- Outer `div.vue-flow__node` with `transform: translate(x,y)`, z-index, pointer events
- Selection state (`.selected` class), drag state (`.dragging` class, `cursor: grab/grabbing`)
- d3-drag integration with `noDragClassName` filter (default: `"nodrag"`)
- Scroll exclusion via `noWheelClassName` (default: `"nowheel"`)
- ARIA: `role="group"`, `aria-roledescription="node"`, `tabIndex`, `aria-describedby`, keyboard handler
- ResizeObserver for dimension tracking
- Passes full `NodeProps` to child: `id`, `type`, `data`, `selected`, `dragging`, `resizing`, `connectable`, `position`,
  `dimensions`, `zIndex`, `sourcePosition`, `targetPosition`, `dragHandle`, `label`, `events`, `parentNodeId`

Custom nodes (BaseNode etc.) handle:

- Inner content: header, body slots, subnodes, handles
- Domain-specific styling and layout

## Known Bugs (Pre-existing)

1. **Action buttons trigger drag**: `.base-node-action-button` elements in `BaseNode.vue` lack `nodrag` class. d3-drag's
   filter checks `hasSelector(target, '.nodrag', nodeEl)` -- without the class, mousedown on buttons initiates a drag.
2. **Collapsible toggles trigger drag**: `.module-section-toggle` in `ModuleNode.vue` and toggle buttons in
   `SymbolNode.vue` also lack `nodrag`.
3. **No `nowheel` on scrollable node content**: Scrollable regions inside nodes can trigger canvas zoom/pan.
4. `**cursor: move` vs `cursor: grab` inconsistency: BaseNode sets `cursor: move` on `.base-node-container` (line 199)
   while NodeWrapper uses `cursor: grab`/`grabbing`.
5. **Duplicated selection styling**: Both NodeWrapper (`.selected` on outer div) and BaseNode (`.base-node-selected` on
   inner div) apply selection visuals. Not a functional bug, but confusing.
6. `**DependencyProps` too narrow: Omits `dragging`, `resizing`, `connectable`, `position`, `dimensions`,
   `parentNodeId`, `dragHandle`, `events` from Vue Flow's full `NodeProps`. Limits future feature use.
7. `**baseNodeProps` computed duplicated in 3 files: ModuleNode, PackageNode, SymbolNode all manually rebuild the same
   prop-forwarding object.
8. **Global `CustomEvent` bus**: BaseNode dispatches
   `window.dispatchEvent(new CustomEvent('dependency-graph-node-action'))` instead of using Vue emit/provide-inject.
   Global listener in `index.vue` receives it.

## Architecture Target

```mermaid
flowchart TD
  vueFlowRoot[VueFlow]

  subgraph builtinPlugins [BuiltInPlugins]
    controlsPlugin["Controls + ControlButton (bottom-right)"]
    minimapPlugin["MiniMap (if parity confirmed)"]
    interactionProps["panOnScroll / zoomOnPinch / noWheelClassName"]
  end

  subgraph domainUX [DomainSpecificUX]
    layoutControls["GraphControls (top-left): layout, filters, clustering"]
    isolateMode[IsolateNeighborhood]
    focusMode[FocusNodeFitSelection]
    drilldownMode[SymbolDrilldown]
    macWheelPolicy["MacWheelIntentPolicy (keep if native insufficient)"]
    graphSearch[GraphSearch]
    nodeDetails[NodeDetails]
  end

  subgraph nodeArch [NodeArchitecture]
    nodeWrapper["NodeWrapper (internal, auto)"]
    baseNode["BaseNode (shared shell)"]
    moduleNode[ModuleNode]
    packageNode[PackageNode]
    symbolNode[SymbolNode]
    groupNode[GroupNode]
  end

  vueFlowRoot --> builtinPlugins
  vueFlowRoot --> domainUX
  vueFlowRoot --> nodeWrapper
  nodeWrapper --> baseNode
  baseNode --> moduleNode
  baseNode --> packageNode
  baseNode --> symbolNode
  nodeWrapper --> groupNode
```

## Migration Strategy (Execution Order)

### Phase 1: Baseline behavior lock (test artifacts)

**Deliverable:** Playwright e2e test suite that passes against the current UI.

Test cases to cover:

- Mouse wheel zoom on non-Mac (deltaMode and deltaY behavior)
- Mac trackpad: two-finger scroll pans, pinch zooms centered on cursor
- Overlay scroll: `NodeDetails` panel scrolls without affecting canvas
- Keyboard: Arrow keys navigate connected nodes, fitView follows
- Minimap: click-to-center, click-on-node centering, viewport rect drag
- Controls: zoom in/out/fit buttons work
- Focus action: clicking focus button on node centers camera
- Isolate action: clicking isolate button filters to neighborhood
- Back to overview: button restores full graph

**Files to create:**

- `tests/e2e/graph-interaction.spec.ts`

**Rollback anchor:** This suite becomes the regression gate for every subsequent phase. If any phase breaks these tests,
revert that phase's changes.

### Phase 2: NodeWrapper alignment + interaction safety hardening

**Goal:** Fix all known interaction bugs before any plugin migration.

**Concrete changes:**

In [BaseNode.vue](src/client/components/DependencyGraph/nodes/BaseNode.vue):

- Add `class="nodrag"` to both `.base-node-action-button` elements (lines 142-159)
- Change `cursor: move` to `cursor: grab` in `.base-node-container` style (line 199)

In [ModuleNode.vue](src/client/components/DependencyGraph/nodes/ModuleNode.vue):

- Add `class="nodrag"` to `.module-section-toggle` buttons
- Add `class="nodrag"` to `.dependency-more-button`
- Add `class="nowheel"` to `.module-section-content` if content is scrollable

In [SymbolNode.vue](src/client/components/DependencyGraph/nodes/SymbolNode.vue):

- Add `class="nodrag"` to any interactive elements inside CollapsibleSection headers

In [GroupNode.vue](src/client/components/DependencyGraph/nodes/GroupNode.vue):

- Add `class="nodrag"` to `.group-node-label` if it becomes interactive in the future (defensive)

**Prop consolidation:**

- Create a shared utility `buildBaseNodeProps(props: DependencyProps, overrides?)` in a new file
  `src/client/components/DependencyGraph/nodes/utils.ts`
- Widen `DependencyProps` in [types.ts](src/client/components/DependencyGraph/types.ts) to include `dragging?: boolean`,
  `connectable?: HandleConnectable`, and `parentNodeId?: string` for forward compatibility
- Replace the 3 duplicated `baseNodeProps` computeds in ModuleNode, PackageNode, SymbolNode with the shared utility

**Acceptance:** Phase 1 tests still pass. Action buttons no longer drag. Scrollable regions no longer zoom canvas.

### Phase 3: Replace global CustomEvent with Vue communication

**Goal:** Eliminate the `window.dispatchEvent` antipattern.

**Approach:** Use Vue `provide`/`inject` to expose a callback from `index.vue` that nodes can call directly.

**Concrete changes:**

In [index.vue](src/client/components/DependencyGraph/index.vue):

- Create an injection key and provide an object:
  `{ focusNode: handleFocusNode, isolateNeighborhood: isolateNeighborhood }`
- Remove `window.addEventListener('dependency-graph-node-action', ...)` from `onMounted`/`onUnmounted`
- Remove `handleNodeActionEvent` function

In [BaseNode.vue](src/client/components/DependencyGraph/nodes/BaseNode.vue):

- `inject` the node-actions object
- Replace `triggerNodeAction('focus')` with `nodeActions.focusNode(props.id)`
- Replace `triggerNodeAction('isolate')` with `nodeActions.isolateNeighborhood(props.id)`
- Remove `triggerNodeAction` function entirely

**Acceptance:** Focus/isolate actions work identically. No global event listeners. Phase 1 tests still pass.

### Phase 4: Integrate Vue Flow Controls for zoom/fit

**Goal:** Use the already-installed `@vue-flow/controls` for zoom in/out, fit view, and lock interactive.

**Concrete changes:**

In [index.vue](src/client/components/DependencyGraph/index.vue):

- Import `Controls` and `ControlButton` from `@vue-flow/controls`
- Import `@vue-flow/controls/dist/style.css`
- Add `<Controls position="bottom-right" :show-interactive="false">` with two `<ControlButton>` children for "Reset
  View" and "Reset Layout"
- The built-in Controls provide zoom in, zoom out, fit view buttons automatically

In [GraphControls.vue](src/client/components/DependencyGraph/components/GraphControls.vue):

- Remove the zoom in/out/fit/reset button group (lines 133-168)
- Keep everything else: layout algorithm, direction, spacing, clustering, node types, member display, analysis,
  relationship types

In [src/index.css](src/index.css):

- Audit lines 171-193 (`.vue-flow__controls` styles). Reconcile with the actual rendered Controls component. Update
  colors/borders to match the dark graph theme, or remove if the component's built-in styles are sufficient.

In [vite.config.ts](vite.config.ts):

- `@vue-flow/controls` is already in `flow-vendor` chunk and `optimizeDeps.include` -- no change needed here

**Panel layout:** Built-in Controls render at `bottom-right`. Custom GraphControls stays at `top-left`. No overlap.

**Acceptance:** Zoom/fit/reset work from the new Controls panel. GraphControls panel is smaller (filters/layout only).
Phase 1 tests still pass. No dormant CSS surprises.

### Phase 5: Evaluate @vue-flow/minimap parity (spike, not migration)

**Goal:** Determine whether the official minimap can replace the custom one **before** committing to the migration.

**Spike checklist (investigate, do not ship):**

1. Install `@vue-flow/minimap` temporarily
2. Test `nodeColor` prop with a function: can it reproduce `nodeFill()` (package=teal, module=blue,
   class/interface=amber)?
3. Test `nodeStrokeColor` prop: can it highlight the selected node with `#22d3ee`?
4. Test `pannable` + `zoomable`: does it match the current viewport-rect drag behavior?
5. Can individual node clicks in the minimap center the viewport? (Custom `GraphMiniMap` has `centerOnNode`)
6. Does the minimap properly render edges?

**Decision gate:**

- If items 1-4 are satisfactory and item 5 can be achieved via the `node-${type}` slot, proceed with migration behind a
  feature flag (env var `VITE_USE_BUILTIN_MINIMAP=true`)
- If item 5 or 6 cannot be replicated, **keep the custom minimap** and document why. Do not force a lateral move.

**If proceeding:**

- Add `@vue-flow/minimap` to `flow-vendor` chunk in [vite.config.ts](vite.config.ts)
- Implement toggle in `index.vue` using `import.meta.env.VITE_USE_BUILTIN_MINIMAP === 'true'`
- Conditionally render `<MiniMap>` or `<GraphMiniMap>`

**Acceptance:** Spike document with pass/fail for each checklist item. If migrating: both minimaps work behind flag,
Phase 1 tests pass with either.

### Phase 6: Evaluate Vue Flow native interaction vs custom wheel handler

**Goal:** Determine if the custom `handleWheel` + `classifyWheelIntent` can be removed.

**Test matrix (must pass on macOS Chrome, Safari, and Firefox):**

- Two-finger trackpad scroll -> Pan canvas (`panOnScroll: true`)
- Pinch-to-zoom (trackpad) -> Zoom centered on cursor (`zoomOnPinch: true`)
- Mouse wheel (vertical) -> Zoom (`zoomOnScroll: true`)
- Scroll inside NodeDetails overlay -> Scroll overlay, not canvas (`noWheelClassName` on overlay)

**Concrete test:**

- Temporarily set `panOnScroll: true`, `zoomOnScroll: true`, `zoomOnPinch: true` and remove the custom `handleWheel`
  listener
- Replace `data-graph-overlay-scrollable` with `class="nowheel"` on the NodeDetails panel
- Run Phase 1 tests on macOS

**Decision gate:**

- If all gestures behave correctly: remove `handleWheel`, `classifyWheelIntent`, `wheelIntent.ts`, and the `isMac`
  conditional props
- If trackpad scroll vs pinch is not properly distinguished by Vue Flow's built-in d3-zoom handler (likely -- Vue Flow
  uses `event.ctrlKey` for pinch which matches browser behavior, but cursor-centered zoom math may differ): **keep the
  custom handler** and document specifically which gesture fails

**Acceptance:** Either the custom handler is removed with passing tests, or a documented decision to keep it with
specific failure evidence.

### Phase 7: Evaluate @vue-flow/node-toolbar for focus/isolate (spike)

**Goal:** Determine if `NodeToolbar` improves the focus/isolate action surface.

**Concerns specific to this codebase:**

- Nodes are dense; a floating toolbar may occlude neighbors
- Current inline buttons (in the node header) are always visible on hover -- toolbar would show only on selection
- Keyboard reachability: toolbar must be tab-reachable when node is focused

**Spike checklist:**

1. Install `@vue-flow/node-toolbar` temporarily
2. Move focus/isolate buttons into `<NodeToolbar :position="Position.Top" :offset="12">` inside BaseNode
3. Test with 50+ node graphs: does the toolbar occlude content?
4. Test keyboard: can you Tab to toolbar buttons after focusing a node?
5. Test screen reader: are toolbar buttons announced?

**Decision gate:**

- If toolbar UX is clearly better or equivalent: adopt and remove inline buttons
- If occlusion or keyboard issues: **keep inline buttons**. The inline approach is fine.
- If adopting: add `@vue-flow/node-toolbar` to `flow-vendor` chunk in `vite.config.ts`

### Phase 8: Final verification

- Run full Phase 1 Playwright suite
- WCAG keyboard-only walkthrough: every action reachable without mouse
- Focus visibility audit: every focusable element has visible focus indicator
- Screen reader check: node actions, controls, and minimap are announced
- Visual regression: compare screenshots before/after migration

**Acceptance:** All Phase 1 tests green. No new WCAG violations. Commit and tag.

## Rollback Strategy

Every phase operates on a dedicated git branch forked from the previous phase's merge commit. If a phase fails its
acceptance gate:

1. `git checkout` the previous phase's branch
2. Document the failure in the spike/decision log
3. Skip the phase; proceed to next independent phase

Phases 5, 6, and 7 are evaluation spikes that produce a decision document, not necessarily code changes. They can be
abandoned with zero rollback cost.

## Build Configuration Checklist

When adding new `@vue-flow/*` packages:

- Add to `dependencies` in [package.json](package.json)
- Add to `manualChunks['flow-vendor']` in [vite.config.ts](vite.config.ts) (line 49)
- Add to `optimizeDeps.include` in [vite.config.ts](vite.config.ts) (line 55)
- Import the package's CSS file (e.g., `@vue-flow/minimap/dist/style.css`)

## Spike Evaluation Results

### Phase 5: @vue-flow/minimap — Implemented behind feature flag

**Checklist results:**

| #   | Check                                         | Result                                                  |
| --- | --------------------------------------------- | ------------------------------------------------------- |
| 1   | `nodeColor` function reproduces custom colors | ✅ Pass                                                 |
| 2   | `nodeStrokeColor` highlights selected node    | ✅ Pass                                                 |
| 3   | `pannable` + `zoomable` viewport drag         | ✅ Pass                                                 |
| 4   | `nodeClick` event for click-to-center         | ✅ Pass                                                 |
| 5   | Individual node click centering               | ✅ Pass (via `nodeClick` event → `handleFocusNode`)     |
| 6   | Edge rendering in minimap                     | ❌ Fail — official minimap renders nodes only, no edges |

**Decision:** Implemented behind `VITE_USE_BUILTIN_MINIMAP=true` feature flag. Default is `false` (custom minimap with
edge rendering). The official minimap is a viable replacement for use cases where edge rendering in the minimap is not
critical.

**Files changed:** `index.vue` (conditional rendering), `vite.config.ts` (build chunks)

### Phase 6: Vue Flow native interaction — Custom handler retained

**Test matrix analysis:**

| Gesture                              | Vue Flow native                            | Custom handler                                      | Verdict                                        |
| ------------------------------------ | ------------------------------------------ | --------------------------------------------------- | ---------------------------------------------- |
| Two-finger trackpad scroll → Pan     | `panOnScroll: true`                        | `classifyWheelIntent('trackpadScroll')` → `panBy()` | Both work, custom more precise                 |
| Pinch-to-zoom → Cursor-centered zoom | `zoomOnPinch: true` (uses `event.ctrlKey`) | Custom `setViewport()` with cursor math             | Custom zoom is cursor-centered with exact math |
| Mouse wheel → Zoom                   | `zoomOnScroll: true`                       | `classifyWheelIntent('mouseWheel')` → `zoomTo()`    | Both work                                      |
| Overlay scroll isolation             | `noWheelClassName` on overlay              | `data-graph-overlay-scrollable` check               | Both work, now using both                      |

**Decision:** Keep the custom `handleWheel` + `classifyWheelIntent` handler. Reasons:

1. The custom handler provides precise cursor-centered zoom via `setViewport()` math that Vue Flow's d3-zoom may not
   exactly replicate
2. The `classifyWheelIntent` heuristic distinguishes trackpad scroll vs mouse wheel using delta magnitude, which is more
   nuanced than d3-zoom's `ctrlKey` check
3. Cannot verify removal without testing on physical Mac hardware across Chrome, Safari, and Firefox
4. Risk of UX regression outweighs benefit of removing ~40 lines of code

**Defense-in-depth:** Added `nowheel` class to `NodeDetails` overlay alongside existing `data-graph-overlay-scrollable`
attribute.

**Files changed:** `NodeDetails.vue` (added `nowheel` class)

### Phase 7: @vue-flow/node-toolbar — Inline buttons retained

**Evaluation results:**

| #   | Check                            | Result                                                                                     |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | Toolbar positions correctly      | ✅ Works (Top/Bottom/Left/Right with offset)                                               |
| 2   | Z-index stacking in dense graphs | ⚠️ Auto-calculated but may occlude neighboring nodes                                       |
| 3   | Visibility behavior              | ❌ Only shows on single-node selection; current inline buttons are always visible on hover |
| 4   | Keyboard tab reachability        | ❌ Not built-in — no tabindex, no ARIA, no focus management                                |
| 5   | Screen reader announcement       | ❌ Not built-in — must implement in slot content                                           |

**Decision:** Keep current inline action buttons in `BaseNode.vue` header. Reasons:

1. **Discoverability**: Inline buttons are always visible in the node header; toolbar only appears on selection
2. **Keyboard accessibility**: NodeToolbar has no built-in keyboard navigation; inline buttons are naturally
   tab-reachable
3. **Dense graph UX**: Floating toolbar may occlude neighboring nodes in dense layouts
4. **WCAG compliance**: Current inline buttons already have proper `aria-label` attributes and are focus-visible

**Files changed:** None (decision to keep current implementation)
