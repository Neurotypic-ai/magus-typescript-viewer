/**
 * Folder distributor graph builder: prioritize folder grouping and node
 * distribution. Optionally renders intra-folder edges when the strategy
 * option is enabled.
 */

import { collapseFolders } from './cluster/collapseFolders';
import { buildNodeToFolderMap } from './cluster/folderMembership';
import { clusterByFolder } from './cluster/folders';
import { applyEdgeVisibility, bundleParallelEdges, filterEdgesByNodeSet, type GraphViewData } from './graphViewShared';
import { createGraphEdges } from '../utils/createGraphEdges';
import { createGraphNodes } from '../utils/createGraphNodes';

import type { DependencyNode } from '../types/DependencyNode';
import type { DependencyPackageGraph } from '../types/DependencyPackageGraph';
import type { GraphEdge } from '../types/GraphEdge';

export interface BuildFolderDistributorGraphOptions {
  data: DependencyPackageGraph;
  enabledNodeTypes: Iterable<string>;
  enabledRelationshipTypes: string[];
  direction: 'LR' | 'RL' | 'TB' | 'BT';
  clusterByFolder?: boolean;
  collapseScc?: boolean;
  collapsedFolderIds: Set<string>;
  hideTestFiles: boolean;
  memberNodeMode: 'compact' | 'graph';
  highlightOrphanGlobal: boolean;
  strategyOptions?: Record<string, unknown>;
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

/** Keep only edges where both endpoints belong to the same folder group. */
function filterIntraFolderEdges(nodes: DependencyNode[], edges: GraphEdge[]): GraphEdge[] {
  const nodeToFolder = buildNodeToFolderMap(nodes);
  return edges.filter((edge) => {
    if (edge.source === edge.target) return false;
    const sourceFolder = nodeToFolder.get(edge.source);
    const targetFolder = nodeToFolder.get(edge.target);
    if (!sourceFolder || !targetFolder) return false;
    return sourceFolder === targetFolder;
  });
}

export function buildFolderDistributorGraph(options: BuildFolderDistributorGraphOptions): GraphViewData {
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
    nestSymbolsInModules: false,
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
  const semanticSnapshot = {
    nodes: filteredGraph.nodes,
    edges: filteredGraph.edges,
  };

  const clusteredGraph = clusterByFolder(filteredGraph.nodes, filteredGraph.edges);
  const collapsedGraph =
    options.collapsedFolderIds.size > 0
      ? collapseFolders(clusteredGraph.nodes, clusteredGraph.edges, options.collapsedFolderIds)
      : { nodes: clusteredGraph.nodes, edges: clusteredGraph.edges };

  const showIntraFolderEdges =
    typeof options.strategyOptions?.['showIntraFolderEdges'] === 'boolean'
      ? options.strategyOptions['showIntraFolderEdges']
      : false;

  let renderedEdges: GraphEdge[] = [];
  if (showIntraFolderEdges) {
    const intraEdges = filterIntraFolderEdges(collapsedGraph.nodes, collapsedGraph.edges);
    const routedEdges = intraEdges.map((edge) => ({
      ...edge,
      type: 'intraFolder' as const,
    }));
    const visibleEdges = applyEdgeVisibility(routedEdges, options.enabledRelationshipTypes);
    renderedEdges = bundleParallelEdges(visibleEdges);
  }

  const currentDegreeMap = buildDegreeMap(collapsedGraph.nodes, collapsedGraph.edges, false);
  const globalDegreeMap = buildDegreeMap(unfilteredGraph.nodes, unfilteredGraph.edges, true);
  const nodesWithDiagnostics = annotateOrphanDiagnostics(collapsedGraph.nodes, currentDegreeMap, globalDegreeMap);

  return {
    nodes: nodesWithDiagnostics,
    edges: renderedEdges,
    semanticSnapshot,
  };
}
