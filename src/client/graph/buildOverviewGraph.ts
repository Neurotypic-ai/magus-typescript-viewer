/**
 * Overview graph building: nodes/edges from package graph, folder/SCC transforms, visibility.
 */

import { collapseFolders } from './cluster/collapseFolders';
import { clusterByFolder } from './cluster/folders';
import { collapseSccs } from './cluster/scc';
import { isValidEdgeConnection } from './edgeTypeRegistry';
import { applyEdgeHighways } from './transforms/edgeHighways';
import { createGraphEdges } from '../utils/createGraphEdges';
import { createGraphNodes } from '../utils/createGraphNodes';
import {
  filterEdgesByNodeSet,
  bundleParallelEdges,
  applyEdgeVisibility,
  type GraphViewData,
} from './graphViewShared';

import type { DependencyKind } from '../types/DependencyKind';
import type { DependencyNode } from '../types/DependencyNode';
import type { DependencyPackageGraph } from '../types/DependencyPackageGraph';
import type { GraphEdge } from '../types/GraphEdge';

const EDGE_REGISTRY_DEBUG =
  import.meta.env.DEV && (import.meta.env['VITE_DEBUG_EDGE_REGISTRY'] as string | undefined) === 'true';
const EDGE_REGISTRY_DEBUG_SAMPLE_LIMIT = 5;

export interface BuildOverviewGraphOptions {
  data: DependencyPackageGraph;
  enabledNodeTypes: Iterable<string>;
  enabledRelationshipTypes: string[];
  direction: 'LR' | 'RL' | 'TB' | 'BT';
  clusterByFolder: boolean;
  collapseScc: boolean;
  collapsedFolderIds: Set<string>;
  hideTestFiles: boolean;
  memberNodeMode: 'compact' | 'graph';
  highlightOrphanGlobal: boolean;
}

function applyGraphTransforms(
  graphData: GraphViewData,
  options: Pick<BuildOverviewGraphOptions, 'clusterByFolder' | 'collapseScc'>
): GraphViewData {
  let transformedNodes = graphData.nodes;
  let transformedEdges = graphData.edges;
  const folderClusteringEnabled = options.clusterByFolder;

  if (!folderClusteringEnabled && options.collapseScc) {
    const collapsed = collapseSccs(transformedNodes, transformedEdges);
    transformedNodes = collapsed.nodes;
    transformedEdges = collapsed.edges;
  }

  if (folderClusteringEnabled) {
    const clustered = clusterByFolder(transformedNodes, transformedEdges);
    transformedNodes = clustered.nodes;
    transformedEdges = clustered.edges;
  }

  return {
    nodes: transformedNodes,
    edges: filterEdgesByNodeSet(transformedNodes, transformedEdges),
  };
}

function validateEdgesAgainstRegistry(nodes: DependencyNode[], edges: GraphEdge[]): void {
  if (!EDGE_REGISTRY_DEBUG) return;

  const kindByNodeId = new Map<string, DependencyKind>();
  let invalidCount = 0;
  const sample: {
    edgeId: string;
    kind: string;
    source: string;
    sourceKind: DependencyKind;
    target: string;
    targetKind: DependencyKind;
  }[] = [];
  for (const node of nodes) {
    if (node.type) kindByNodeId.set(node.id, node.type as DependencyKind);
  }
  edges.forEach((edge) => {
    const kind = edge.data?.type;
    if (!kind) return;
    const sourceKind = kindByNodeId.get(edge.source);
    const targetKind = kindByNodeId.get(edge.target);
    if (!sourceKind || !targetKind) return;
    if (!isValidEdgeConnection(kind, sourceKind, targetKind)) {
      invalidCount += 1;
      if (sample.length < EDGE_REGISTRY_DEBUG_SAMPLE_LIMIT) {
        sample.push({
          edgeId: edge.id,
          kind,
          source: edge.source,
          sourceKind,
          target: edge.target,
          targetKind,
        });
      }
    }
  });
  if (invalidCount > 0) {
    console.warn(
      `[buildGraphView] ${String(invalidCount)} edge(s) failed edge-type registry validation. ` +
        'Set VITE_DEBUG_EDGE_REGISTRY=false (or unset) to silence this check.',
      { sample }
    );
  }
}

function filterGraphByTestVisibility(graphData: GraphViewData, hideTestFiles: boolean): GraphViewData {
  if (!hideTestFiles) return graphData;
  const filteredNodes = graphData.nodes.filter((node) => node.data?.diagnostics?.isTestFile !== true);
  return {
    nodes: filteredNodes,
    edges: filterEdgesByNodeSet(filteredNodes, graphData.edges),
  };
}

function buildDegreeMap(
  nodes: DependencyNode[],
  edges: GraphEdge[],
  includeHiddenEdges = false
): Map<string, number> {
  const degreeMap = new Map<string, number>();
  nodes.forEach((node) => degreeMap.set(node.id, 0));
  edges.forEach((edge) => {
    if (!includeHiddenEdges && edge.hidden) return;
    if (degreeMap.has(edge.source)) degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    if (degreeMap.has(edge.target)) degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  });
  return degreeMap;
}

function annotateOrphanDiagnostics(
  nodes: DependencyNode[],
  currentDegreeMap: Map<string, number>,
  globalDegreeMap: Map<string, number>
): DependencyNode[] {
  return nodes.map((node) => {
    const orphanCurrent = (currentDegreeMap.get(node.id) ?? 0) === 0;
    const orphanGlobal = (globalDegreeMap.get(node.id) ?? 0) === 0;
    const existingData = node.data ?? { label: node.id };
    const existingDiagnostics = node.data?.diagnostics;
    return {
      ...node,
      data: {
        ...existingData,
        label: existingData.label,
        diagnostics: {
          isTestFile: existingDiagnostics?.isTestFile === true,
          orphanCurrent,
          orphanGlobal,
          externalDependencyPackageCount: existingDiagnostics?.externalDependencyPackageCount ?? 0,
          externalDependencySymbolCount: existingDiagnostics?.externalDependencySymbolCount ?? 0,
          externalDependencyLevel: existingDiagnostics?.externalDependencyLevel ?? 'normal',
        },
      },
    };
  });
}

export function buildOverviewGraph(options: BuildOverviewGraphOptions): GraphViewData {
  const enabledNodeTypeSet = new Set(options.enabledNodeTypes);
  const includePackages = enabledNodeTypeSet.has('package');
  const includeModules = enabledNodeTypeSet.has('module');
  const includeClassNodes = enabledNodeTypeSet.has('class');
  const includeInterfaceNodes = enabledNodeTypeSet.has('interface');
  const includeClassEdges = includeClassNodes || includeInterfaceNodes;
  const symbolNodesRequested = includeClassNodes || includeInterfaceNodes;
  const resolvedMemberNodeMode: 'compact' | 'graph' =
    !includeModules && symbolNodesRequested ? 'graph' : options.memberNodeMode;

  const graphNodes = createGraphNodes(options.data, {
    includePackages,
    includeModules,
    includeClasses: includeClassEdges,
    includeClassNodes,
    includeInterfaceNodes,
    nestSymbolsInModules: !options.clusterByFolder,
    memberNodeMode: resolvedMemberNodeMode,
    direction: options.direction,
  });

  const includeClassEdgesInGraph = includeClassEdges && resolvedMemberNodeMode === 'graph';
  const graphEdges = createGraphEdges(options.data, {
    includePackageEdges: includePackages,
    includeClassEdges: includeClassEdgesInGraph,
    liftClassEdgesToModuleLevel: !includeClassEdgesInGraph,
    importDirection: 'importer-to-imported',
  }) as unknown as GraphEdge[];

  const unfilteredGraph = {
    nodes: graphNodes,
    edges: filterEdgesByNodeSet(graphNodes, graphEdges),
  };
  const filteredGraph = filterGraphByTestVisibility(unfilteredGraph, options.hideTestFiles);
  const semanticSnapshot = { nodes: filteredGraph.nodes, edges: filteredGraph.edges };
  validateEdgesAgainstRegistry(semanticSnapshot.nodes, semanticSnapshot.edges);

  const transformedGraph = applyGraphTransforms(filteredGraph, {
    clusterByFolder: options.clusterByFolder,
    collapseScc: options.collapseScc,
  });

  let projectedGraph = transformedGraph;
  if (options.clusterByFolder) {
    projectedGraph = applyEdgeHighways(transformedGraph.nodes, transformedGraph.edges, {
      direction: options.direction,
    });
    if (options.collapsedFolderIds.size > 0) {
      const folderCollapsed = collapseFolders(
        projectedGraph.nodes,
        projectedGraph.edges,
        options.collapsedFolderIds
      );
      projectedGraph = { nodes: folderCollapsed.nodes, edges: folderCollapsed.edges };
    }
  }

  const visibleEdges = applyEdgeVisibility(projectedGraph.edges, options.enabledRelationshipTypes);
  const bundledEdges = bundleParallelEdges(visibleEdges);
  const currentDegreeMap = buildDegreeMap(projectedGraph.nodes, bundledEdges, false);
  const globalDegreeMap = buildDegreeMap(unfilteredGraph.nodes, unfilteredGraph.edges, true);
  const nodesWithDiagnostics = annotateOrphanDiagnostics(
    projectedGraph.nodes,
    currentDegreeMap,
    globalDegreeMap
  );

  return {
    nodes: nodesWithDiagnostics,
    edges: bundledEdges,
    semanticSnapshot,
  };
}
