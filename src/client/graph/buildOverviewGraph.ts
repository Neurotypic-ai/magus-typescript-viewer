/**
 * Overview graph building: nodes/edges from package graph, folder transforms, visibility.
 *
 * Implements the Sugiyama framework for DAG layout:
 *   1. DFS back-edge detection (cycle breaking)
 *   2. Longest-path layering (integer layers + fan-in weighted depth)
 *   3. Barycenter heuristic (distance-weighted, multi-pass crossing minimization)
 *   4. Folder aggregation (min-rank weight, mean layer, mean sortOrder)
 */

import { consola } from 'consola';

import { createGraphEdges } from '../utils/createGraphEdges';
import { createGraphNodes } from '../utils/createGraphNodes';
import { collapseFolders } from './cluster/collapseFolders';
import { clusterByFolder } from './cluster/folders';
import { isValidEdgeConnection } from './edgeTypeRegistry';
import { FOLDER_HANDLE_IDS } from './handleRouting';
import { applyEdgeVisibility, bundleParallelEdges, filterEdgesByNodeSet } from './graphViewShared';

import type { PackageGraph } from '../../shared/types/Package';
import type { DependencyData } from '../../shared/types/graph/DependencyData';
import type { DependencyKind } from '../../shared/types/graph/DependencyKind';
import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';
import type { GraphViewData } from './graphViewShared';

const EDGE_REGISTRY_DEBUG =
  import.meta.env.DEV && (import.meta.env['VITE_DEBUG_EDGE_REGISTRY'] as string | undefined) === 'true';
const EDGE_REGISTRY_DEBUG_SAMPLE_LIMIT = 5;
const overviewGraphLogger = consola.withTag('OverviewGraph');

export interface BuildOverviewGraphOptions {
  data: PackageGraph;
  enabledRelationshipTypes: string[];
  direction: 'LR' | 'RL' | 'TB' | 'BT';
  collapsedFolderIds: Set<string>;
  hideTestFiles: boolean;
  highlightOrphanGlobal: boolean;
}

function applyGraphTransforms(graphData: GraphViewData): GraphViewData {
  const clustered = clusterByFolder(graphData.nodes, graphData.edges);
  return {
    nodes: clustered.nodes,
    edges: filterEdgesByNodeSet(clustered.nodes, clustered.edges),
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
    overviewGraphLogger.warn(
      `${String(invalidCount)} edge(s) failed edge-type registry validation. ` +
        'Set VITE_DEBUG_EDGE_REGISTRY=false (or unset) to silence this check.',
      { sample }
    );
  }
}

function filterGraphByTestVisibility(graphData: GraphViewData, hideTestFiles: boolean): GraphViewData {
  if (!hideTestFiles) return graphData;
  const filteredNodes = graphData.nodes.filter((node) => {
    const data = node.data;
    return data?.diagnostics?.isTestFile !== true;
  });
  return {
    nodes: filteredNodes,
    edges: filterEdgesByNodeSet(filteredNodes, graphData.edges),
  };
}

function buildDegreeMap(nodes: DependencyNode[], edges: GraphEdge[], includeHiddenEdges = false): Map<string, number> {
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
    const existingData: DependencyData = node.data ?? { label: node.id };
    const existingDiagnostics = existingData.diagnostics;
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

/**
 * DFS back-edge detection for cycle marking (Sugiyama framework).
 *
 * During DFS traversal, any edge that points to an ancestor on the current
 * DFS stack is a "back-edge" — the edge that closes a cycle.  Returns the
 * set of edge IDs that are back-edges so they can be marked for special
 * styling (dashed, different color) and excluded from layering.
 */
function detectBackEdges(nodes: DependencyNode[], edges: GraphEdge[]): Set<string> {
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Build adjacency: source → [{target, edgeId}]
  const adj = new Map<string, { target: string; edgeId: string }[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const edge of edges) {
    if (edge.hidden || edge.data?.type !== 'import') continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adj.get(edge.source)?.push({ target: edge.target, edgeId: edge.id });
  }

  const backEdgeIds = new Set<string>();
  const visited = new Set<string>();
  const onStack = new Set<string>();

  function dfs(nodeId: string): void {
    visited.add(nodeId);
    onStack.add(nodeId);
    for (const { target, edgeId } of adj.get(nodeId) ?? []) {
      if (onStack.has(target)) {
        backEdgeIds.add(edgeId);
      } else if (!visited.has(target)) {
        dfs(target);
      }
    }
    onStack.delete(nodeId);
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) dfs(id);
  }
  return backEdgeIds;
}

function markBackEdges(edges: GraphEdge[], backEdgeIds: Set<string>): GraphEdge[] {
  if (backEdgeIds.size === 0) return edges;
  return edges.map((edge) => {
    if (!backEdgeIds.has(edge.id)) return edge;
    return { ...edge, data: { ...edge.data, isBackEdge: true } };
  });
}

function computeModuleLayoutWeights(
  nodes: DependencyNode[],
  edges: GraphEdge[],
  backEdgeIds?: Set<string>
): Map<string, number> {
  // Build adjacency: edge.source imports edge.target (importer-to-imported)
  // Back-edges (cycle-creating) are excluded for cleaner layering.
  const importsOf = new Map<string, Set<string>>();
  const nodeIds = new Set<string>();

  for (const node of nodes) {
    nodeIds.add(node.id);
    importsOf.set(node.id, new Set());
  }

  // Build import adjacency and fan-in counts (how many modules import each target)
  const fanIn = new Map<string, number>();
  for (const id of nodeIds) fanIn.set(id, 0);

  for (const edge of edges) {
    if (edge.hidden || edge.data?.type !== 'import') continue;
    if (backEdgeIds?.has(edge.id)) continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    importsOf.get(edge.source)?.add(edge.target);
    fanIn.set(edge.target, (fanIn.get(edge.target) ?? 0) + 1);
  }

  // Step cost: modules with higher fan-in create larger layout gaps.
  // log₂ scaling keeps weights bounded while creating meaningful separation.
  //   fanIn=1 → cost 1 (same as previous uniform-depth algorithm)
  //   fanIn=2 → cost 2,  fanIn=4 → cost 3,  fanIn=8 → cost 4
  function stepCost(targetId: string): number {
    const inDegree = fanIn.get(targetId) ?? 0;
    return 1 + Math.log2(Math.max(1, inDegree));
  }

  // Memoized longest-path weighted depth with cycle detection.
  // Each edge step is weighted by the fan-in of its target, so heavily-imported
  // foundations push their consumers further right in the layout.
  const depthCache = new Map<string, number>();
  const visiting = new Set<string>();

  function computeWeightedDepth(nodeId: string): number {
    const cached = depthCache.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) return 0; // cycle → treat as leaf

    visiting.add(nodeId);
    const imports = importsOf.get(nodeId);
    let maxPathCost = -1;
    if (imports) {
      for (const targetId of imports) {
        const pathCost = stepCost(targetId) + computeWeightedDepth(targetId);
        maxPathCost = Math.max(maxPathCost, pathCost);
      }
    }
    visiting.delete(nodeId);

    const depth = maxPathCost === -1 ? 0 : maxPathCost;
    depthCache.set(nodeId, depth);
    return depth;
  }

  // layoutWeight = -weightedDepth → foundations (0) left, consumers (negative) right
  const weights = new Map<string, number>();
  for (const node of nodes) {
    const depth = computeWeightedDepth(node.id);
    weights.set(node.id, depth > 0 ? -depth : 0);
  }
  return weights;
}

/**
 * Sugiyama longest-path layering with uniform step cost.
 * Assigns integer layer indices: foundations = 0, consumers = higher layers.
 */
function computeLayerAssignment(
  nodes: DependencyNode[],
  edges: GraphEdge[],
  backEdgeIds?: Set<string>
): Map<string, number> {
  const importsOf = new Map<string, Set<string>>();
  const nodeIds = new Set<string>();

  for (const node of nodes) {
    nodeIds.add(node.id);
    importsOf.set(node.id, new Set());
  }
  for (const edge of edges) {
    if (edge.hidden || edge.data?.type !== 'import') continue;
    if (backEdgeIds?.has(edge.id)) continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    importsOf.get(edge.source)?.add(edge.target);
  }

  const layerCache = new Map<string, number>();
  const visiting = new Set<string>();

  function computeLayer(nodeId: string): number {
    const cached = layerCache.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) return 0; // cycle → treat as leaf

    visiting.add(nodeId);
    const imports = importsOf.get(nodeId);
    let maxLayer = -1;
    if (imports) {
      for (const targetId of imports) {
        maxLayer = Math.max(maxLayer, 1 + computeLayer(targetId));
      }
    }
    visiting.delete(nodeId);

    const layer = maxLayer === -1 ? 0 : maxLayer;
    layerCache.set(nodeId, layer);
    return layer;
  }

  const layers = new Map<string, number>();
  for (const node of nodes) {
    layers.set(node.id, computeLayer(node.id));
  }
  return layers;
}

/**
 * Barycenter heuristic for Sugiyama crossing minimization.
 *
 * For each layer, computes the average position of each node's neighbors
 * in adjacent layers, then sorts the layer by that average. Runs alternating
 * left-to-right and right-to-left sweeps to converge on minimal crossings.
 */
function computeBarycenterSortOrder(
  nodes: DependencyNode[],
  edges: GraphEdge[],
  layerMap: Map<string, number>,
  backEdgeIds?: Set<string>
): Map<string, number> {
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Build bidirectional adjacency for import edges, excluding back-edges
  const neighbors = new Map<string, Set<string>>();
  for (const id of nodeIds) neighbors.set(id, new Set());
  for (const edge of edges) {
    if (edge.hidden || edge.data?.type !== 'import') continue;
    if (backEdgeIds?.has(edge.id)) continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
  }

  // Group nodes by layer
  const maxLayer = Math.max(0, ...layerMap.values());
  const layerBuckets: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const node of nodes) {
    const layer = layerMap.get(node.id) ?? 0;
    layerBuckets[layer]?.push(node.id);
  }

  // Initialize: sort each layer alphabetically for determinism
  for (const bucket of layerBuckets) {
    bucket.sort();
  }

  // Position map: nodeId → current index within its layer
  const position = new Map<string, number>();
  function updatePositions(): void {
    for (const bucket of layerBuckets) {
      bucket.forEach((id, idx) => position.set(id, idx));
    }
  }
  updatePositions();

  // Distance-weighted barycenter: considers ALL neighbors, not just adjacent layer.
  // Closer neighbors have more influence (weight = 1/distance). This handles long
  // edges (43% of edges span >1 layer) that the standard adjacent-only approach misses.
  // sweepDirection: 'left' considers neighbors in layers < current, 'right' in layers > current
  function weightedBarycenter(nodeId: string, nodeLayer: number, sweepDirection: 'left' | 'right'): number | undefined {
    const nodeNeighbors = neighbors.get(nodeId);
    if (!nodeNeighbors) return undefined;

    let weightedSum = 0;
    let totalWeight = 0;
    for (const nbr of nodeNeighbors) {
      const nbrLayer = layerMap.get(nbr);
      if (nbrLayer === undefined) continue;
      // Only consider neighbors in the sweep direction
      if (sweepDirection === 'left' && nbrLayer >= nodeLayer) continue;
      if (sweepDirection === 'right' && nbrLayer <= nodeLayer) continue;

      const distance = Math.abs(nbrLayer - nodeLayer);
      const weight = 1 / distance;
      const nbrPos = position.get(nbr) ?? 0;
      weightedSum += nbrPos * weight;
      totalWeight += weight;
    }
    return totalWeight > 0 ? weightedSum / totalWeight : undefined;
  }

  // Run 4 sweeps (2 full passes of L→R then R→L).
  // Nodes with no neighbors in the sweep direction keep their current position
  // (stable fallback) instead of being pushed to the bottom.
  const SWEEP_PASSES = 2;
  for (let pass = 0; pass < SWEEP_PASSES; pass++) {
    // Left-to-right: layer 1, 2, ... use neighbors in lower layers
    for (let l = 1; l <= maxLayer; l++) {
      const bucket = layerBuckets[l];
      if (!bucket || bucket.length <= 1) continue;
      bucket.sort((a, b) => {
        const ba = weightedBarycenter(a, l, 'left') ?? position.get(a) ?? 0;
        const bb = weightedBarycenter(b, l, 'left') ?? position.get(b) ?? 0;
        return ba - bb || a.localeCompare(b);
      });
    }
    updatePositions();

    // Right-to-left: layer maxLayer-1, ..., 0 use neighbors in higher layers
    for (let l = maxLayer - 1; l >= 0; l--) {
      const bucket = layerBuckets[l];
      if (!bucket || bucket.length <= 1) continue;
      bucket.sort((a, b) => {
        const ba = weightedBarycenter(a, l, 'right') ?? position.get(a) ?? 0;
        const bb = weightedBarycenter(b, l, 'right') ?? position.get(b) ?? 0;
        return ba - bb || a.localeCompare(b);
      });
    }
    updatePositions();
  }

  // Return final positions as sortOrder
  const sortOrder = new Map<string, number>();
  for (const [id, pos] of position) {
    sortOrder.set(id, pos);
  }
  return sortOrder;
}

function applyModuleWeights(
  nodes: DependencyNode[],
  weights: Map<string, number>,
  layerMap?: Map<string, number>,
  sortOrderMap?: Map<string, number>
): DependencyNode[] {
  return nodes.map((node) => {
    const weight = weights.get(node.id);
    if (weight === undefined) return node;
    const existingData: DependencyData = node.data ?? { label: node.id };
    const data: DependencyData = { ...existingData, layoutWeight: weight };
    const layer = layerMap?.get(node.id);
    if (layer !== undefined) data.layerIndex = layer;
    const sort = sortOrderMap?.get(node.id);
    if (sort !== undefined) data.sortOrder = sort;
    return { ...node, data };
  });
}

/**
 * Lifts cross-folder edges to the folder level.
 *
 * For each edge whose source and target belong to DIFFERENT folder group nodes,
 * the edge is replaced by a folder→folder edge (parentNode(source) → parentNode(target)).
 * Duplicate folder→folder pairs for the same edge type are deduplicated and their
 * count is recorded in `data.aggregatedCount`.
 *
 * Intra-folder edges (same parent folder) and edges without a parent are left unchanged.
 * Must be called after `clusterByFolder` has assigned `parentNode` to modules.
 */
function liftCrossfolderEdgesToFolderLevel(nodes: DependencyNode[], edges: GraphEdge[]): GraphEdge[] {
  const parentById = new Map<string, string | undefined>();
  for (const node of nodes) {
    parentById.set(node.id, node.parentNode);
  }

  const edgeMap = new Map<string, GraphEdge>();
  const aggregatedCount = new Map<string, number>();
  const sourceStubs = new Map<string, GraphEdge>();
  const targetStubs = new Map<string, GraphEdge>();

  for (const edge of edges) {
    const sourceParent = parentById.get(edge.source);
    const targetParent = parentById.get(edge.target);

    if (sourceParent && targetParent && sourceParent !== targetParent) {
      // Cross-folder: lift to folder→folder edge and deduplicate
      const type = edge.data?.type ?? 'import';
      const key = `${sourceParent}|${targetParent}|${type}`;
      aggregatedCount.set(key, (aggregatedCount.get(key) ?? 0) + 1);

      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          ...edge,
          id: key,
          source: sourceParent,
          target: targetParent,
          sourceHandle: FOLDER_HANDLE_IDS.rightOut,
          targetHandle: FOLDER_HANDLE_IDS.leftIn,
          type: 'crossFolder',
        });
      }

      // Source stub: child module → source folder right boundary
      const srcKey = `stub-src|${edge.source}|${sourceParent}`;
      if (!sourceStubs.has(srcKey)) {
        sourceStubs.set(srcKey, {
          ...edge,
          id: srcKey,
          source: edge.source,
          target: sourceParent,
          sourceHandle: 'relational-out',
          targetHandle: FOLDER_HANDLE_IDS.rightStub,
          type: 'folderStub',
          markerEnd: undefined,
        });
      }

      // Target stub: target folder left boundary → child module
      const tgtKey = `stub-tgt|${targetParent}|${edge.target}`;
      if (!targetStubs.has(tgtKey)) {
        targetStubs.set(tgtKey, {
          ...edge,
          id: tgtKey,
          source: targetParent,
          target: edge.target,
          sourceHandle: FOLDER_HANDLE_IDS.leftStub,
          targetHandle: 'relational-in',
          type: 'folderStub',
          markerEnd: undefined,
        });
      }
    } else {
      // Intra-folder or folder-level: keep as-is (deduplicate by canonical key)
      const type = edge.data?.type ?? 'import';
      const key = edge.id || `${edge.source}|${edge.target}|${type}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, edge);
      }
    }
  }

  // Stamp aggregatedCount onto each lifted edge
  const result = Array.from(edgeMap.values()).map((edge) => {
    const count = aggregatedCount.get(edge.id);
    if (count === undefined || count <= 1) return edge;
    return { ...edge, data: { ...edge.data, aggregatedCount: count } };
  });

  return [...result, ...sourceStubs.values(), ...targetStubs.values()];
}

function aggregateFolderWeights(nodes: DependencyNode[]): DependencyNode[] {
  // Sugiyama: folderRank = min(rank(child)) — place folder flush-left with its
  // earliest child.  Since weight = -rank, min(rank) = max(weight).
  // Folder layerIndex = mean(child layerIndices) — center folder among its children's layers.
  // Using mean distributes folders evenly; min would cluster all foundation-containing folders at layer 0.
  // Folder sortOrder = mean(child sortOrders) — center folder vertically on children.
  const folderMaxWeight = new Map<string, number>();
  const folderLayerSums = new Map<string, { sum: number; count: number }>();
  const folderSortSums = new Map<string, { sum: number; count: number }>();
  for (const node of nodes) {
    if (node.parentNode) {
      const childWeight = node.data?.layoutWeight ?? 0;
      const current = folderMaxWeight.get(node.parentNode);
      folderMaxWeight.set(node.parentNode, current === undefined ? childWeight : Math.max(current, childWeight));

      const childLayer: number | undefined = node.data?.layerIndex;
      if (childLayer !== undefined) {
        const acc = folderLayerSums.get(node.parentNode) ?? { sum: 0, count: 0 };
        acc.sum += childLayer;
        acc.count += 1;
        folderLayerSums.set(node.parentNode, acc);
      }

      const childSort: number | undefined = node.data?.sortOrder;
      if (childSort !== undefined) {
        const acc = folderSortSums.get(node.parentNode) ?? { sum: 0, count: 0 };
        acc.sum += childSort;
        acc.count += 1;
        folderSortSums.set(node.parentNode, acc);
      }
    }
  }
  if (folderMaxWeight.size === 0) return nodes;
  return nodes.map((node) => {
    const weight = folderMaxWeight.get(node.id);
    if (weight === undefined) return node;
    const existingData: DependencyData = node.data ?? { label: node.id };
    const data: DependencyData = { ...existingData, layoutWeight: weight };
    const layerAcc = folderLayerSums.get(node.id);
    if (layerAcc && layerAcc.count > 0) data.layerIndex = Math.round(layerAcc.sum / layerAcc.count);
    const sortAcc = folderSortSums.get(node.id);
    if (sortAcc && sortAcc.count > 0) data.sortOrder = sortAcc.sum / sortAcc.count;
    return { ...node, data };
  });
}

export function buildOverviewGraph(options: BuildOverviewGraphOptions): GraphViewData {
  const graphNodes = createGraphNodes(options.data, {
    includePackages: false,
    includeModules: true,
    includeClasses: false,
    includeClassNodes: true,
    includeInterfaceNodes: true,
    nestSymbolsInModules: false,
    memberNodeMode: 'compact',
    direction: options.direction,
  });

  const graphEdges = createGraphEdges(options.data, {
    includePackageEdges: false,
    includeClassEdges: false,
    liftClassEdgesToModuleLevel: true,
    importDirection: 'importer-to-imported',
  });

  const unfilteredGraph = {
    nodes: graphNodes,
    edges: filterEdgesByNodeSet(graphNodes, graphEdges),
  };
  const filteredGraph = filterGraphByTestVisibility(unfilteredGraph, options.hideTestFiles);
  const backEdgeIds = detectBackEdges(filteredGraph.nodes, filteredGraph.edges);
  const edgesWithBackEdgeMarks = markBackEdges(filteredGraph.edges, backEdgeIds);
  const semanticSnapshot = { nodes: filteredGraph.nodes, edges: edgesWithBackEdgeMarks };
  validateEdgesAgainstRegistry(semanticSnapshot.nodes, semanticSnapshot.edges);

  const moduleWeights = computeModuleLayoutWeights(semanticSnapshot.nodes, semanticSnapshot.edges, backEdgeIds);
  const layerAssignment = computeLayerAssignment(semanticSnapshot.nodes, semanticSnapshot.edges, backEdgeIds);
  const sortOrder = computeBarycenterSortOrder(semanticSnapshot.nodes, semanticSnapshot.edges, layerAssignment, backEdgeIds);
  const weightedFilteredGraph = {
    nodes: applyModuleWeights(filteredGraph.nodes, moduleWeights, layerAssignment, sortOrder),
    edges: edgesWithBackEdgeMarks,
  };

  const transformedGraph = applyGraphTransforms(weightedFilteredGraph);

  const nodesWithFolderWeights = aggregateFolderWeights(transformedGraph.nodes);
  const edgesWithCrossfolderTypes = liftCrossfolderEdgesToFolderLevel(nodesWithFolderWeights, transformedGraph.edges);

  let projectedGraph: GraphViewData = {
    nodes: nodesWithFolderWeights,
    edges: edgesWithCrossfolderTypes,
  };
  if (options.collapsedFolderIds.size > 0) {
    const folderCollapsed = collapseFolders(projectedGraph.nodes, projectedGraph.edges, options.collapsedFolderIds);
    projectedGraph = { nodes: folderCollapsed.nodes, edges: folderCollapsed.edges };
  }

  const visibleEdges = applyEdgeVisibility(projectedGraph.edges, options.enabledRelationshipTypes);
  const bundledEdges = bundleParallelEdges(visibleEdges);
  const currentDegreeMap = buildDegreeMap(projectedGraph.nodes, bundledEdges, false);
  const globalDegreeMap = buildDegreeMap(unfilteredGraph.nodes, unfilteredGraph.edges, true);
  const nodesWithDiagnostics = annotateOrphanDiagnostics(projectedGraph.nodes, currentDegreeMap, globalDegreeMap);

  return {
    nodes: nodesWithDiagnostics,
    edges: bundledEdges,
    semanticSnapshot,
  };
}
