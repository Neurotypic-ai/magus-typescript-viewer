# ELK Layout Improvements - Implementation Summary

## Overview

Fixed single-line layout issue by switching from hierarchical/compound layout to flat layout, correcting ELK direction
mapping, excluding containment edges from layout constraints, and adding enhanced ELK layered options for better node
distribution.

## Root Cause

The original implementation used ELK's hierarchical mode (`INCLUDE_CHILDREN`) where nodes were nested inside their
parents (packages contain modules, modules contain classes). When containment edges were filtered out, ELK had no edges
connecting top-level packages, causing all packages to be placed in a single line. The actual dependency edges (imports,
inheritance) only connected deeply nested children, which didn't influence the top-level layout.

## Changes Made

### 1. Type System Updates

**File: `src/client/components/DependencyGraph/types.ts`**

- Added `'contains'` to `DependencyEdgeKind` type to properly classify parent-child containment relationships

### 2. Edge Creation Updates

**File: `src/client/utils/createGraphEdges.ts`**

- Updated all containment edges (package→module, module→class, module→interface) to use `type: 'contains'`
- These edges now render but don't constrain the layout algorithm

### 3. Layout Configuration Mapping

**File: `src/client/layout/WebWorkerLayoutProcessor.ts`**

- Fixed direction mapping: `TB→DOWN`, `BT→UP`, `LR→RIGHT`, `RL→LEFT`
- Updated `LayoutConfig` interface to use ELK's expected direction values
- Added `mapDirection()` helper function for proper conversion

### 4. Worker Layout Algorithm (CRITICAL FIX)

**File: `src/client/workers/GraphLayoutWorker.ts`**

- **Switched from hierarchical to flat layout**: Removed compound node structure where children were nested inside
  parents
- All nodes are now siblings at the same level, allowing ELK's layered algorithm to work properly
- Removed `'elk.hierarchyHandling': 'INCLUDE_CHILDREN'` option
- Updated to use corrected `config.direction` (DOWN/UP/RIGHT/LEFT)
- Filters out `contains` edges before passing to ELK for layout computation
- Returns all edges (including containment) for rendering
- Enhanced ELK options:
  - `'elk.layered.layering.strategy': 'NETWORK_SIMPLEX'` - Better layer assignment for DAGs
  - `'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED'` - Centers nodes within layers
  - `'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH'` - Reduces whitespace
  - `'elk.layered.spacing.edgeNodeBetweenLayers'` - Better edge-node spacing between layers
- Simplified position extraction logic for flat layout

### 5. UI Controls

**File: `src/client/components/DependencyGraph/components/GraphControls.vue`**

- Added Layout Direction controls (LR, RL, TB, BT buttons)
- Added Node Spacing slider (50-200)
- Added Rank Spacing slider (100-300)
- Emits `layout-change` event to trigger re-layout

### 6. Main Graph Component

**File: `src/client/components/DependencyGraph/index.vue`**

- Added `layoutConfig` reactive state
- Implemented `handleLayoutChange()` to update config and re-run layout
- Updated `toDependencyEdgeKind()` to include 'contains' type
- Wired up GraphControls `layout-change` event

## Key Improvements

### Layout Quality

1. **Flat Layout Structure**: Nodes are no longer nested hierarchically, allowing ELK to distribute them based on actual
   dependencies
2. **Correct Direction**: ELK now receives proper direction values (RIGHT/DOWN/etc.)
3. **Balanced Layers**: NETWORK_SIMPLEX strategy creates more balanced layer assignments
4. **Better Node Placement**: BALANCED alignment centers nodes within their layers
5. **No Containment Constraints**: Hierarchy edges no longer force deep vertical chains
6. **Multi-dimensional Distribution**: Nodes now spread across both axes instead of forming a single line

### User Experience

1. **Interactive Controls**: Users can now adjust layout direction and spacing in real-time
2. **Visual Feedback**: Active direction button is highlighted
3. **Smooth Updates**: Layout recalculates on-demand with animation

## Technical Notes

### Flat vs Hierarchical Layout

**Before**: Used compound/hierarchical layout where nodes were nested

```typescript
// Hierarchical structure
Package A (parent)
  ├─ Module A1 (child)
  │   ├─ Class A1a (grandchild)
  │   └─ Class A1b (grandchild)
  └─ Module A2 (child)
```

Problem: When containment edges were filtered, packages had no connections at the top level, so ELK placed them in a
single line.

**After**: Uses flat layout where all nodes are siblings

```typescript
// Flat structure
[Package A, Module A1, Class A1a, Class A1b, Module A2, Package B, ...]
```

Solution: ELK can now see all dependency edges (imports, inheritance) and distribute nodes across layers properly.

### Edge Filtering

- Containment edges are filtered out before ELK layout: `edge.data?.type !== 'contains'`
- All edges (including containment) are returned to VueFlow for rendering
- This allows hierarchical visualization without layout constraints

### Direction Mapping

```typescript
TB → DOWN   // Top to Bottom
BT → UP     // Bottom to Top
LR → RIGHT  // Left to Right (default)
RL → LEFT   // Right to Left
```

### ELK Options Added

- `elk.layered.layering.strategy: NETWORK_SIMPLEX` - Optimal layer assignment
- `elk.layered.nodePlacement.bk.fixedAlignment: BALANCED` - Node centering
- `elk.layered.spacing.edgeNodeBetweenLayers` - Edge-node spacing
- `elk.layered.compaction.postCompaction.strategy: EDGE_LENGTH` - Whitespace reduction

## Testing

- ✅ Build succeeds with no errors
- ✅ All TypeScript types validated
- ✅ No linter errors

## Next Steps (Optional)

1. Measure actual node dimensions after first render for more accurate spacing
2. Add debouncing to layout recalculation for slider changes
3. Persist layout preferences to localStorage
4. Add toggle for "Include containment in layout" option
