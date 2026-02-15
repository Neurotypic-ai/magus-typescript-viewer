---
name: ""
overview: ""
todos: []
isProject: false
---

# Flatten DependencyGraph: move under client, type files = type name

## Goal

- **Remove the `DependencyGraph` subfolder** and move its contents **up one layer under
`src/client/**`(outside`components/`).
- Use **Vue-style layout** under `client/`: composables/, types/, layout/, nodes/, components/, lib/.
- **Types: one file per type, file name identical to type name including casing** (e.g. `DependencyKind.ts`,
`GraphEdge.ts`).

---

## Target structure (under `src/client/`)

```
src/client/
  composables/                    # All use* and edge-visibility logic (from DependencyGraph)
    useGraphLayout.ts
    useIsolationMode.ts
    useEdgeVirtualization.ts
    useEdgeVirtualizationWorker.ts
    useEdgeVirtualizationOrchestrator.ts
    edgeVirtualizationCore.ts
    edgeVisibilityApply.ts
    edgeVisibilityMessages.ts
    useSelectionHighlighting.ts
    useSearchHighlighting.ts
    useNodeHoverZIndex.ts
    useNodeDimensions.ts
    useGraphViewport.ts
    useCollisionResolution.ts
    useFpsCounter.ts
    useGraphInteractionController.ts
  types/                          # One file per type; file name = type name (casing)
    index.ts                       # Re-exports all
    DependencyKind.ts
    DependencyEdgeKind.ts
    HandleCategory.ts
    NodeMethod.ts
    NodeProperty.ts
    ImportSpecifierRef.ts
    ExternalDependencyRef.ts
    SubnodeMetadata.ts
    MemberMetadata.ts
    EmbeddedSymbol.ts
    NodeDiagnostics.ts
    LayoutInsets.ts
    DependencyData.ts
    DependencyNode.ts
    DependencyProps.ts
    GraphEdge.ts
    DependencyGraph.ts
    DependencyRef.ts
    ImportRef.ts
    InterfaceRef.ts
    FunctionStructure.ts
    TypeAliasStructure.ts
    EnumStructure.ts
    VariableStructure.ts
    EmbeddedModuleEntity.ts
    ModuleStructure.ts
    SymbolReferenceRef.ts
    ClassStructure.ts
    InterfaceStructure.ts
    PackageStructure.ts
    DependencyPackageGraph.ts
    SearchResult.ts
    CodeIssueRef.ts
  layout/                         # Merge: existing WebWorkerLayoutProcessor + graph layout
    WebWorkerLayoutProcessor.ts   # (existing)
    config.ts                     # from DependencyGraph/layout
    edgeGeometryPolicy.ts
    geometryBounds.ts
    collisionResolver.ts
  nodes/                          # Graph node Vue components (from DependencyGraph/nodes)
    BaseNode.vue
    PackageNode.vue
    ModuleNode.vue
    GroupNode.vue
    SymbolNode.vue
    ... (rest of nodes)
    nodes.ts
    utils.ts
    useIsolateExpandState.ts
  components/                     # Top-level + graph UI (DependencyGraph.vue, NodeContextMenu, etc.)
    DependencyGraph.vue           # Main graph (from DependencyGraph/index.vue)
    DependencyGraphLazy.vue       # Lazy wrapper
    ErrorBoundary.vue
    NodeContextMenu.vue
    IssuesPanel.vue
    InsightsDashboard.vue
    GraphControls.vue
    CanvasEdgeLayer.vue
    NodeDetails.vue
    GraphSearch.vue
  lib/                            # Graph helpers (buildGraphView, graphUtils, etc.)
    buildGraphView.ts
    graphUtils.ts
    edgeKindUtils.ts
    handleAnchors.ts
    mapTypeCollection.ts
  utils/                          # Existing client utils (createGraphNodes, etc.) + wheelIntent
    (existing + move DependencyGraph/utils/wheelIntent here or keep under graph)
  workers/
  stores/
  graph/
  assemblers/
  theme/
  ...
```

---

## Type files: name = type name (identical casing)

Each type lives in a file with the **exact same name** as the type:


| Type                     | File                              |
| ------------------------ | --------------------------------- |
| `DependencyKind`         | `types/DependencyKind.ts`         |
| `DependencyEdgeKind`     | `types/DependencyEdgeKind.ts`     |
| `HandleCategory`         | `types/HandleCategory.ts`         |
| `NodeMethod`             | `types/NodeMethod.ts`             |
| `NodeProperty`           | `types/NodeProperty.ts`           |
| `ImportSpecifierRef`     | `types/ImportSpecifierRef.ts`     |
| `ExternalDependencyRef`  | `types/ExternalDependencyRef.ts`  |
| `SubnodeMetadata`        | `types/SubnodeMetadata.ts`        |
| `MemberMetadata`         | `types/MemberMetadata.ts`         |
| `EmbeddedSymbol`         | `types/EmbeddedSymbol.ts`         |
| `NodeDiagnostics`        | `types/NodeDiagnostics.ts`        |
| `LayoutInsets`           | `types/LayoutInsets.ts`           |
| `DependencyData`         | `types/DependencyData.ts`         |
| `DependencyNode`         | `types/DependencyNode.ts`         |
| `DependencyProps`        | `types/DependencyProps.ts`        |
| `GraphEdge`              | `types/GraphEdge.ts`              |
| `DependencyGraph`        | `types/DependencyGraph.ts`        |
| `DependencyRef`          | `types/DependencyRef.ts`          |
| `ImportRef`              | `types/ImportRef.ts`              |
| `InterfaceRef`           | `types/InterfaceRef.ts`           |
| `FunctionStructure`      | `types/FunctionStructure.ts`      |
| `TypeAliasStructure`     | `types/TypeAliasStructure.ts`     |
| `EnumStructure`          | `types/EnumStructure.ts`          |
| `VariableStructure`      | `types/VariableStructure.ts`      |
| `EmbeddedModuleEntity`   | `types/EmbeddedModuleEntity.ts`   |
| `ModuleStructure`        | `types/ModuleStructure.ts`        |
| `SymbolReferenceRef`     | `types/SymbolReferenceRef.ts`     |
| `ClassStructure`         | `types/ClassStructure.ts`         |
| `InterfaceStructure`     | `types/InterfaceStructure.ts`     |
| `PackageStructure`       | `types/PackageStructure.ts`       |
| `DependencyPackageGraph` | `types/DependencyPackageGraph.ts` |
| `SearchResult`           | `types/SearchResult.ts`           |
| `CodeIssueRef`           | `types/CodeIssueRef.ts`           |


`types/index.ts` re-exports every type so consumers can `import { DependencyNode, GraphEdge } from '@/client/types'` (or
`../types`).

---

## Dependency order for type files

Type files must import only from other type files that are already defined. Suggested order:

1. **Leaf types (no internal type deps):** DependencyKind, DependencyEdgeKind, HandleCategory, LayoutInsets, NodeMethod,
  NodeProperty, ImportSpecifierRef, InterfaceRef, DependencyRef, NodeDiagnostics, MemberMetadata, SymbolReferenceRef.
2. **ExternalDependencyRef** (ImportSpecifierRef), **SubnodeMetadata** (DependencyKind), **EmbeddedSymbol** (NodeMethod,
  NodeProperty), **FunctionStructure**, **TypeAliasStructure**, **EnumStructure**, **VariableStructure**,
   **EmbeddedModuleEntity**.
3. **DependencyData** (NodeMethod, NodeProperty, SubnodeMetadata, MemberMetadata, EmbeddedSymbol, NodeDiagnostics,
  LayoutInsets, EmbeddedModuleEntity, ExternalDependencyRef).
4. **DependencyNode** (Vue Flow Node + DependencyData).
5. **DependencyProps** (DependencyKind, DependencyData, Position).
6. **GraphEdge** (Vue Flow Edge + DependencyEdgeKind).
7. **DependencyGraph** (DependencyNode, GraphEdge).
8. **ImportRef** (inline specifiers or ImportSpecifierRef).
9. **ClassStructure** (InterfaceRef, NodeMethod, NodeProperty), **InterfaceStructure** (InterfaceRef, NodeMethod,
  NodeProperty).
10. **ModuleStructure** (ImportRef, SymbolReferenceRef, ClassStructure, InterfaceStructure, FunctionStructure,
  TypeAliasStructure, EnumStructure, VariableStructure).
11. **PackageStructure** (DependencyRef, ModuleStructure).
12. **DependencyPackageGraph** (PackageStructure).
13. **SearchResult** (DependencyNode, GraphEdge).
14. **CodeIssueRef** (no deps).

---

## Import path changes

### Internal (moved files)

- **Composables:** Import types from `../types` or `../types/index`; layout from `../layout/...`; nodes from
`../nodes/...`; components from `../components/...`; lib from `../lib/...`.
- **Layout:** Import types from `../types`; lib (e.g. handleAnchors) from `../lib/...`.
- **Nodes:** Import types from `../types`; composables from `../composables/...`; lib from `../lib/...`.
- **components:** Import types from `../types`; composables from `../composables/...`; lib from `../lib/...`.
- **lib:** Import types from `../types`; layout from `../layout/...`.

### Main Vue components (stay under components/)

- **components/DependencyGraph.vue** and **components/DependencyGraphLazy.vue** import from `@/client/types`,
`@/client/composables/...`, `@/client/layout/...`, `@/client/nodes/...`, `@/client/components/...`, `@/client/lib/...`
(or relative paths like `../composables/...` if components is under client and you use client-relative paths).

### External (rest of app)

- **App.vue:** `./components/DependencyGraph/DependencyGraphLazy.vue` → `./components/DependencyGraphLazy.vue`.
- **client/workers/EdgeVisibilityWorker.ts:** `../components/DependencyGraph/edgeVirtualizationCore` →
`../composables/edgeVirtualizationCore`; same for edgeVisibilityMessages.
- **client/workers/GraphLayoutWorker.ts:** `../components/DependencyGraph/layout/...` → `../layout/...`;
`../components/DependencyGraph/types` → `../types`.
- **client/utils/createGraphNodes.ts, createGraphEdges.ts:** `../components/DependencyGraph/...` → `../lib/...` or
`../types`.
- **client/stores/**, **client/graph/**, **client/assemblers/**, **client/theme/**,
**client/layout/WebWorkerLayoutProcessor.ts:** Replace any `.../components/DependencyGraph/types` with `.../types`;
`.../components/DependencyGraph/layout/...` with `.../layout/...`; `.../components/DependencyGraph/...` with
`.../lib/...` or `.../composables/...` as appropriate.

Use the barrel `client/types/index.ts` so external code keeps a single entry: `from '@/client/types'` or
`from '../types'`.

---

## Execution order

1. Create under `client/`: `composables/`, `types/`, `nodes/`, `components/`, `lib/`. Add graph layout files into
  existing `client/layout/`.
2. **Types:** Add one file per type under `client/types/` with **exact type name** (e.g. `DependencyKind.ts`), in
  dependency order; then add `types/index.ts` re-exporting all.
3. **Lib:** Move buildGraphView, graphUtils, edgeKindUtils, handleAnchors, mapTypeCollection to `client/lib/`; fix their
  imports to use `../types`, `../layout`.
4. **Layout:** Move DependencyGraph/layout/ into `client/layout/`; fix imports (types, lib).
5. **Composables:** Move all use and edge-visibility files from DependencyGraph to `client/composables/`; fix imports
  (types, layout, nodes, components, lib).
6. **Nodes:** Move DependencyGraph/nodes/ to `client/nodes/`; fix imports.
7. **components:** Move DependencyGraph/components/ into `client/components/` (alongside DependencyGraph.vue,
  DependencyGraphLazy.vue, ErrorBoundary.vue); fix imports.
8. **Main component:** Move DependencyGraph/index.vue → components/DependencyGraph.vue and
  DependencyGraph/DependencyGraphLazy.vue → components/DependencyGraphLazy.vue; update their imports to
   client/composables, client/types, client/layout, client/nodes, client/components, client/lib.
9. **Utils:** Move DependencyGraph/utils (e.g. wheelIntent) into `client/utils/` or keep under a graph-specific path;
  update imports.
10. **Tests:** Move DependencyGraph/**tests** to `client/__tests__/` or colocate next to layout/lib; update paths.
11. **Remove** the empty `components/DependencyGraph/` directory.
12. **External references:** Update App.vue, workers, stores, graph, assemblers, theme, layout, and all tests to use
  `client/types`, `client/layout`, `client/composables`, `client/lib`, and `components/DependencyGraphLazy.vue` /
    `components/DependencyGraph.vue`.
13. Run lint and tests; fix any remaining path or type errors.

---

## Summary

- **One level up:** Everything that lived under `components/DependencyGraph/` is reorganized under `**src/client/**`
(composables, types, layout, nodes, components, lib). The main Vue entry points (DependencyGraph.vue,
DependencyGraphLazy.vue, ErrorBoundary.vue) and all graph UI (NodeContextMenu, GraphControls, etc.) live in
`**client/components/**`.
- **Type file names:** Each type has its own file with the **exact same name** as the type, including casing (e.g.
`DependencyKind.ts`, `GraphEdge.ts`). A single barrel `client/types/index.ts` re-exports all.

