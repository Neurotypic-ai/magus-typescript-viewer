/**
 * Thin re-export entry for graph building. No barrel: callers import from this file.
 * Implementation lives in buildOverviewGraph, drilldown/, and graphViewShared.
 */

import type { NodeChange } from '@vue-flow/core';

import type { DependencyNode } from '../types/DependencyNode';

export type { GraphViewData } from './graphViewShared';
export type { BuildOverviewGraphOptions } from './buildOverviewGraph';
export type { BuildFolderDistributorGraphOptions } from './buildFolderDistributorGraph';
export type { BuildModuleDrilldownGraphOptions } from './drilldown/buildModuleDrilldown';
export type { BuildSymbolDrilldownGraphOptions } from './drilldown/buildSymbolDrilldown';

export { buildOverviewGraph } from './buildOverviewGraph';
// eslint-disable-next-line import-x/no-unresolved -- module exists; TS and runtime resolve it; resolver does not
export { buildFolderDistributorGraph } from './buildFolderDistributorGraph';
export { buildModuleDrilldownGraph } from './drilldown/buildModuleDrilldown';
export { buildSymbolDrilldownGraph } from './drilldown/buildSymbolDrilldown';
export { applyEdgeVisibility } from './graphViewShared';
export { toDependencyEdgeKind } from './edgeKindUtils';

export function filterNodeChangesForFolderMode(
  changes: NodeChange[],
  _nodes: DependencyNode[],
  folderModeEnabled: boolean
): NodeChange[] {
  if (!folderModeEnabled) return changes;
  return changes;
}
