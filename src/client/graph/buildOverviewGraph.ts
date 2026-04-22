/**
 * Overview graph building: nodes/edges from package graph, folder transforms, visibility.
 *
 * Implements the Sugiyama framework for DAG layout:
 *   1. DFS back-edge detection (cycle breaking)
 *   2. Longest-path layering (integer layers + fan-in weighted depth)
 *   3. Barycenter heuristic (distance-weighted, multi-pass crossing minimization)
 *   4. Folder aggregation (min-rank weight, mean layer, mean sortOrder)
 *   5. Folder-level second pass: re-runs (1–3) on the folder subgraph so that
 *      folders connected by `crossFolder` edges are ranked by their folder-level
 *      dependency direction, not by whichever child module happens to be the
 *      shallowest.
 */

import { consola } from 'consola';

import { createGraphEdges } from '../utils/createGraphEdges';
import { createGraphNodes } from '../utils/createGraphNodes';
import { collapseFolders } from './cluster/collapseFolders';
import { clusterByFolder } from './cluster/folders';
import { isValidEdgeConnection } from './edgeTypeRegistry';
import { FOLDER_HANDLE_IDS } from './handleRouting';
import { applyEdgeVisibility, bundleParallelEdges, filterEdgesByNodeSet } from './graphViewShared';
import { bundleFanInTrunks } from './layout/bundleFanInTrunks';
import { computeStronglyConnectedComponents, condenseBySCC } from './layout/condenseBySCC';
import { partitionForLayout } from './layout/partitionForLayout';
import { layoutSCCInternal } from './layout/sccInternalLayout';

import type { PackageGraph } from '../../shared/types/Package';
import type { DependencyData } from '../../shared/types/graph/DependencyData';
import type { DependencyEdgeKind } from '../../shared/types/graph/DependencyEdgeKind';
import type { DependencyKind } from '../../shared/types/graph/DependencyKind';
import type { LayoutRankTrace, RankContribution } from '../../shared/types/graph/LayoutRankTrace';
import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';
import type { SccSupernodeMeta } from './layout/condenseBySCC';
import type { GraphViewData } from './graphViewShared';

/**
 * Edge kinds that participate in Sugiyama layering: the module-level
 * import graph plus the per-package.json-scope classifications used for
 * module → externalPackage edges. Symbol-level edges (uses/contains) are
 * excluded because they add noise to the layering without changing the
 * module dependency structure.
 */
const LAYERING_EDGE_KINDS: ReadonlySet<DependencyEdgeKind> = new Set([
  'import',
  'dependency',
  'devDependency',
  'peerDependency',
]);

function isLayeringEdge(edge: GraphEdge): boolean {
  const type = edge.data?.type;
  return type !== undefined && LAYERING_EDGE_KINDS.has(type);
}

const EDGE_REGISTRY_DEBUG =
  import.meta.env.DEV && (import.meta.env['VITE_DEBUG_EDGE_REGISTRY'] as string | undefined) === 'true';
const EDGE_REGISTRY_DEBUG_SAMPLE_LIMIT = 5;
const overviewGraphLogger = consola.withTag('OverviewGraph');

export interface BuildOverviewGraphOptions {
  data: PackageGraph;
  enabledRelationshipTypes: string[];
  /**
   * @deprecated Layout is hardcoded LR regardless of this value. Retained
   * only so existing callers (drilldown builders, tests) keep compiling.
   * Will be removed when per-edge side assignment lands.
   */
  direction: 'LR' | 'RL' | 'TB' | 'BT';
  collapsedFolderIds: Set<string>;
  hideTestFiles: boolean;
  highlightOrphanGlobal: boolean;
  /**
   * Phase 1 feature flag. Partition externals out of the Sugiyama input and
   * re-join as root-level nodes; `useGraphLayout` positions them in the
   * peripheral band via `layoutExternalBand`.
   */
  useExternalBand?: boolean;
  /**
   * Phase 5 feature flag. Tarjan SCC condensation on the layering subgraph
   * instead of ad-hoc DFS back-edge classification. Cycle-free input produces
   * byte-identical output regardless of this flag.
   */
  useSccCondensation?: boolean;
  /**
   * Phase 2 feature flag. When `true` (default), `assignEdgeSides` runs after
   * positioning so each edge gets a cardinal side at both endpoints.
   */
  useFourSidedHandles?: boolean;
  /**
   * Phase 3 feature flag. When `true` (default), `bundleFanInTrunks` runs
   * after parallel-edge bundling to collapse N-into-1 fan-in into a single
   * trunk + per-source stubs.
   */
  useFanInTrunks?: boolean;
  /**
   * Phase 4 feature flag. When `true` (default), high-degree internal modules
   * are relocated toward the Y-centroid of their neighbours within their
   * layer band (via `relocateInternalHubs` in `useGraphLayout`).
   */
  useInternalHubRelocation?: boolean;
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

/**
 * Stamp a `layoutBand` membership marker on a node (Phase 1 plan §7.1).
 *
 * This tells downstream consumers which of the three populations the node
 * belongs to without needing them to re-derive it from `type`.
 */
function annotateLayoutBand(
  node: DependencyNode,
  band: 'internal' | 'external' | 'scc'
): DependencyNode {
  const existingData: DependencyData = node.data ?? { label: node.id };
  if (existingData.layoutBand === band) return node;
  return { ...node, data: { ...existingData, layoutBand: band } };
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
    if (edge.hidden || !isLayeringEdge(edge)) continue;
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

interface ModuleLayoutWeightResult {
  weights: Map<string, number>;
  traces: Map<string, LayoutRankTrace>;
}

function computeModuleLayoutWeights(
  nodes: DependencyNode[],
  edges: GraphEdge[],
  backEdgeIds?: Set<string>
): ModuleLayoutWeightResult {
  // Build adjacency: edge.source imports edge.target (importer-to-imported)
  // Back-edges (cycle-creating) are excluded for cleaner layering.
  const importsOf = new Map<string, Set<string>>();
  const nodeIds = new Set<string>();
  const labelOf = new Map<string, string>();

  for (const node of nodes) {
    nodeIds.add(node.id);
    importsOf.set(node.id, new Set());
    labelOf.set(node.id, node.data?.label ?? node.id);
  }

  // Build import adjacency and fan-in counts (how many modules import each target)
  const fanIn = new Map<string, number>();
  for (const id of nodeIds) fanIn.set(id, 0);

  for (const edge of edges) {
    if (edge.hidden || !isLayeringEdge(edge)) continue;
    if (backEdgeIds?.has(edge.id)) continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    importsOf.get(edge.source)?.add(edge.target);
    fanIn.set(edge.target, (fanIn.get(edge.target) ?? 0) + 1);
  }

  // Step cost: log₂-scaled by fan-in of the target.
  //   fanIn=1 → cost 1,  fanIn=2 → cost 2,  fanIn=4 → cost 3,  fanIn=8 → cost 4
  //
  // DIAGNOSTIC ONLY — this weight is surfaced via `layoutWeight` / `LayoutRankTrace`
  // in the Rank Debug Panel but does NOT affect rendered X positions. Positioning
  // reads `layerIndex` (uniform-cost) only. Do not assume visual spacing changes
  // when you tweak this.
  function stepCost(targetId: string): number {
    const inDegree = fanIn.get(targetId) ?? 0;
    return 1 + Math.log2(Math.max(1, inDegree));
  }

  // Memoized longest-path weighted depth with cycle detection.
  // Feeds the Rank Debug Panel; see stepCost above for the DIAGNOSTIC-ONLY caveat.
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

  // First pass: populate depthCache for all nodes.
  // layoutWeight = -weightedDepth → foundations (0) left, consumers (negative) right
  const weights = new Map<string, number>();
  for (const node of nodes) {
    const depth = computeWeightedDepth(node.id);
    weights.set(node.id, depth > 0 ? -depth : 0);
  }

  // Second pass: build per-node traces now that depthCache is fully populated.
  const traces = new Map<string, LayoutRankTrace>();
  for (const node of nodes) {
    const weightedDepth = depthCache.get(node.id) ?? 0;
    const layoutWeight = weightedDepth > 0 ? -weightedDepth : 0;
    const imports = importsOf.get(node.id);
    const contributions: RankContribution[] = [];

    if (imports && imports.size > 0) {
      let maxTotal = -Infinity;
      for (const targetId of imports) {
        const sc = stepCost(targetId);
        const targetDepth = depthCache.get(targetId) ?? 0;
        const total = sc + targetDepth;
        if (total > maxTotal) maxTotal = total;
        contributions.push({
          importedId: targetId,
          importedLabel: labelOf.get(targetId) ?? targetId,
          fanIn: fanIn.get(targetId) ?? 0,
          stepCost: sc,
          depth: targetDepth,
          total,
          isWinner: false, // resolved below
        });
      }
      for (const c of contributions) {
        c.isWinner = c.total === maxTotal;
      }
      // Winners first, then by total descending
      contributions.sort((a, b) => {
        if (a.isWinner !== b.isWinner) return a.isWinner ? -1 : 1;
        return b.total - a.total;
      });
    }

    traces.set(node.id, { weightedDepth, layoutWeight, contributions });
  }

  return { weights, traces };
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
    if (edge.hidden || !isLayeringEdge(edge)) continue;
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
    if (edge.hidden || !isLayeringEdge(edge)) continue;
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

  // ── Centrality pyramid (removed in Phase 4) ─────────────────────────────
  //
  // Historical note: earlier versions of this function ran a centrality-
  // weighted "pyramid" re-order here. It sorted each layer by descending
  // degree and walked outward from the middle so that the highest-degree
  // node sat at the centre, with the lowest on the edges. A `CENTRALITY_GATE`
  // constant (value 2) gated the re-order so it only fired when the layer's
  // max degree was ≥ 2× the mean. The intent was to shorten edges to hubs.
  //
  // Phase 4 replaces this discrete approximation with the continuous hub
  // relocation in `relocateInternalHubs` (plan §6 Phase 4, §8.3). The new
  // pass reads real pixel coordinates after Sugiyama + Phase 1 external-band
  // layout have settled, computes each hub's neighbour Y-centroid, and
  // clamps it to the hub's layer Y-band. Running both the pyramid and Phase 4
  // would double-move the hub: Phase 4 would consume the already-re-ordered
  // sortOrder as input, then shift it again with no gain.
  //
  // Keeping the CENTRALITY_GATE constant name + comment here so future
  // readers who encounter a `git blame` pointer at this line understand
  // which pass superseded the pyramid.
  // Former: `const CENTRALITY_GATE = 2` (kept only as a breadcrumb).

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
  sortOrderMap?: Map<string, number>,
  traces?: Map<string, LayoutRankTrace>
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
    const trace = traces?.get(node.id);
    if (trace !== undefined) data.layoutRankTrace = trace;
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
        // Omit markerEnd from trunk — arrow belongs on the target stub only.
        const { markerEnd: _m, ...trunkBase } = edge;
        edgeMap.set(key, {
          ...trunkBase,
          id: key,
          source: sourceParent,
          target: targetParent,
          sourceHandle: FOLDER_HANDLE_IDS.rightOut,
          targetHandle: FOLDER_HANDLE_IDS.leftIn,
          type: 'crossFolder',
        } as GraphEdge);
      }

      // Source stub: child module → source folder right boundary (no arrow)
      const srcKey = `stub-src|${edge.source}|${sourceParent}`;
      if (!sourceStubs.has(srcKey)) {
        const { markerEnd: _m, ...srcBase } = edge;
        sourceStubs.set(srcKey, {
          ...srcBase,
          id: srcKey,
          source: edge.source,
          target: sourceParent,
          sourceHandle: 'relational-out',
          targetHandle: FOLDER_HANDLE_IDS.rightStub,
          type: 'folderStub',
        } as GraphEdge);
      }

      // Target stub: target folder left boundary → child module (keeps arrow)
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
        } as GraphEdge);
      }
    } else {
      // Intra-folder or folder-level: tag with intraFolder type when both nodes share a parent
      const type = edge.data?.type ?? 'import';
      const key = edge.id || `${edge.source}|${edge.target}|${type}`;
      if (!edgeMap.has(key)) {
        if (sourceParent && targetParent && sourceParent === targetParent) {
          edgeMap.set(key, { ...edge, type: 'intraFolder' } as GraphEdge);
        } else {
          edgeMap.set(key, edge);
        }
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

/**
 * Second-pass Sugiyama on the folder subgraph.
 *
 * `aggregateFolderWeights` gives each folder the min-rank of its direct module
 * children — a reasonable default for folders with no cross-folder edges, but
 * it can invert the folder-level import direction when a parent folder happens
 * to contain a shallow "foundation-like" module alongside a deep consumer.
 * Example: `src/` contains both `main.ts` (very deep) and `server.ts` (very
 * shallow); max-aggregation picks `server.ts` and places `src/` at a shallow
 * position, even though `src/main.ts → src/client/App.vue` means the `src/`
 * folder must sit to the right of `src/client/`.
 *
 * This pass re-runs the module-level Sugiyama pipeline on just the folder
 * nodes + lifted `crossFolder` trunks and overwrites the three layout fields
 * for any folder that participates in a folder-level edge.  Folders that are
 * isolated at the folder level keep their aggregated values (handled
 * implicitly: isolated folders compute to weight=0, layer=0, sort=0 under
 * folder-level Sugiyama, which equals the aggregated values only when no
 * module has depth — so we skip them explicitly to preserve the intra-folder
 * signal).
 */
function applyFolderLevelSugiyama(nodes: DependencyNode[], edges: GraphEdge[]): DependencyNode[] {
  const folderNodes = nodes.filter((n) => n.type === 'group');
  if (folderNodes.length === 0) return nodes;

  const folderEdges = edges.filter((e) => e.type === 'crossFolder');
  if (folderEdges.length === 0) return nodes;

  const connectedFolders = new Set<string>();
  for (const edge of folderEdges) {
    connectedFolders.add(edge.source);
    connectedFolders.add(edge.target);
  }

  const folderBackEdges = detectBackEdges(folderNodes, folderEdges);
  const { weights, traces } = computeModuleLayoutWeights(folderNodes, folderEdges, folderBackEdges);
  const layers = computeLayerAssignment(folderNodes, folderEdges, folderBackEdges);
  const sortMap = computeBarycenterSortOrder(folderNodes, folderEdges, layers, folderBackEdges);

  return nodes.map((node) => {
    if (node.type !== 'group' || !connectedFolders.has(node.id)) return node;
    const weight = weights.get(node.id);
    if (weight === undefined) return node;
    const existingData: DependencyData = node.data ?? { label: node.id };
    const data: DependencyData = { ...existingData, layoutWeight: weight };
    const layer = layers.get(node.id);
    if (layer !== undefined) data.layerIndex = layer;
    const sortOrder = sortMap.get(node.id);
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    const trace = traces.get(node.id);
    if (trace !== undefined) data.layoutRankTrace = trace;
    return { ...node, data };
  });
}

function aggregateFolderWeights(nodes: DependencyNode[]): DependencyNode[] {
  // Sugiyama: folderRank = min(rank(child)) — place folder flush-left with its
  // earliest child.  Since weight = -rank, min(rank) = max(weight).
  // Folder layerIndex = mean(child layerIndices) — center folder among its children's layers.
  // Using mean distributes folders evenly; min would cluster all foundation-containing folders at layer 0.
  // Folder sortOrder = mean(child sortOrders) — center folder vertically on children.
  // Folders participating in cross-folder edges are re-ranked by
  // `applyFolderLevelSugiyama` downstream so their layout respects the
  // folder-level import direction rather than the statistical summary here.
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

/**
 * Compute SCC metadata for the Phase 5 condensation path.
 *
 * Runs Tarjan over the layering-edge subgraph only (same subgraph the old
 * `detectBackEdges` used), marks every intra-SCC edge as `isBackEdge: true`
 * for legacy styling consumers, and produces a condensed graph where every
 * non-trivial SCC is replaced by a synthetic `scc`-kind supernode. The
 * condensed graph is a genuine DAG, so downstream Sugiyama passes run on
 * clean input.
 *
 * isBackEdge semantics differ from the old DFS-order-dependent definition:
 * now an edge is `isBackEdge` iff it participates in a cycle (i.e. both
 * endpoints belong to the same non-trivial SCC). This is a canonical
 * property of the graph, independent of traversal order.
 *
 * TODO (plan §10): if an SCC member is inside a folder, the SCC is kept
 * at the root level for now (supernode is a sibling to modules, not a
 * child of any folder). Revisit once SCC × folder interaction is
 * specified.
 */
interface SccCondenseOutcome {
  /** Node set after member nodes have been replaced by supernodes. */
  condensedNodes: DependencyNode[];
  /** Edge set with endpoints rewritten; intra-SCC edges dropped. */
  condensedEdges: GraphEdge[];
  /** Supernodes created (size > 1 SCCs). */
  supernodes: SccSupernodeMeta[];
  /** memberId → supernodeId lookup. */
  memberToSupernode: Map<string, string>;
  /** Edges flagged as isBackEdge (intra-SCC edges). */
  edgesWithBackEdges: GraphEdge[];
}

function runSccCondensation(
  nodes: DependencyNode[],
  edges: GraphEdge[]
): SccCondenseOutcome {
  // Only layering edges decide SCC membership — symbol-level edges are already
  // excluded from the overview, but module→external edges (layering) are kept.
  const layeringEdges = edges.filter((e) => !e.hidden && isLayeringEdge(e));
  const { sccBackEdges } = computeStronglyConnectedComponents(nodes, layeringEdges);

  // Stamp isBackEdge on the full edge set using the canonical intra-SCC
  // classification. This preserves the legacy `isBackEdge` contract for
  // downstream styling/filtering (dashed edges etc.) even though the
  // semantics have changed slightly (see the top-level doc comment).
  const edgesWithBackEdges = markBackEdges(edges, sccBackEdges);

  const { condensedNodes, condensedEdges, supernodes, memberToSupernode } = condenseBySCC(
    nodes,
    edgesWithBackEdges
  );
  return { condensedNodes, condensedEdges, supernodes, memberToSupernode, edgesWithBackEdges };
}

/**
 * After layering has assigned positions to each supernode (logically — we
 * only have `layerIndex`/`sortOrder`, not pixels yet), compute the internal
 * positions of each supernode's members. The positions are relative to the
 * supernode's top-left (0, 0); the coordinate layout pass will translate
 * them into absolute coordinates via Vue Flow's parentNode mechanism.
 */
function attachSccInternalLayouts(
  nodes: DependencyNode[],
  edges: GraphEdge[],
  supernodes: readonly SccSupernodeMeta[]
): DependencyNode[] {
  if (supernodes.length === 0) return nodes;
  const bySupernode = new Map<string, { members: string[]; intra: GraphEdge[] }>();
  for (const sn of supernodes) {
    bySupernode.set(sn.id, { members: sn.members, intra: [] });
  }
  // Collect intra-SCC edges by mapping edge endpoints to supernode ids.
  const memberToSupernode = new Map<string, string>();
  for (const sn of supernodes) {
    for (const m of sn.members) memberToSupernode.set(m, sn.id);
  }
  for (const edge of edges) {
    const src = memberToSupernode.get(edge.source);
    const tgt = memberToSupernode.get(edge.target);
    if (src !== undefined && src === tgt) {
      bySupernode.get(src)?.intra.push(edge);
    }
  }

  return nodes.map((node) => {
    if (node.type !== 'scc') return node;
    const entry = bySupernode.get(node.id);
    if (!entry) return node;
    const layout = layoutSCCInternal(entry.members, entry.intra, node.id);
    const positions: Record<string, { x: number; y: number }> = {};
    for (const [id, pos] of layout.positions) positions[id] = pos;
    const existingData: DependencyData = node.data ?? { label: node.id };
    return {
      ...node,
      data: {
        ...existingData,
        sccMemberPositions: positions,
        sccSize: layout.parentSize,
      },
    };
  });
}

export function buildOverviewGraph(options: BuildOverviewGraphOptions): GraphViewData {
  const graphNodes = createGraphNodes(options.data, {
    includePackages: false,
    includeModules: true,
    includeExternalPackages: true,
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
    // Symbol-level uses edges are pruned from the overview — they duplicate
    // import edges at module granularity and add clutter. Drill-down views
    // still opt in.
    includeUsesEdges: false,
    includeExternalPackageEdges: true,
  });

  const unfilteredGraph = {
    nodes: graphNodes,
    edges: filterEdgesByNodeSet(graphNodes, graphEdges),
  };
  const filteredGraph = filterGraphByTestVisibility(unfilteredGraph, options.hideTestFiles);

  // Phase 1 (plan §4.1 / §6 / §8.1): split the graph into internal vs. external
  // populations so externals don't compete for layer-0 column space with
  // internal foundations. Internal subgraph runs through the full pipeline;
  // externals are re-joined after layering as root-level nodes and positioned
  // by `layoutExternalBand` during coordinate assignment.
  const useExternalBand = options.useExternalBand ?? true;
  const useSccCondensation = options.useSccCondensation ?? true;

  const partitioned = useExternalBand
    ? partitionForLayout(filteredGraph.nodes, filteredGraph.edges)
    : null;
  const layeringInputNodes = partitioned ? partitioned.internal : filteredGraph.nodes;
  const layeringInputEdges = partitioned ? partitioned.internalEdges : filteredGraph.edges;
  const externalIncidentEdges = partitioned ? partitioned.externalIncidentEdges : [];

  // Phase 5: cycle handling via Tarjan SCC condensation on the INTERNAL subgraph.
  // Externals are structurally sinks (no in-scope outgoing imports) so they never
  // appear in SCCs; they're safe to partition out before condensation. Legacy
  // path (flag OFF) uses DFS back-edge classification on the same input.
  let condensedNodes: DependencyNode[];
  let condensedEdges: GraphEdge[];
  let supernodes: SccSupernodeMeta[];
  let memberToSupernode: Map<string, string>;
  let edgesWithBackEdgeMarks: GraphEdge[];
  let backEdgeIds: Set<string>;

  if (useSccCondensation) {
    const outcome = runSccCondensation(layeringInputNodes, layeringInputEdges);
    condensedNodes = outcome.condensedNodes;
    condensedEdges = outcome.condensedEdges;
    supernodes = outcome.supernodes;
    memberToSupernode = outcome.memberToSupernode;
    edgesWithBackEdgeMarks = outcome.edgesWithBackEdges;
    // backEdgeIds contains intra-SCC edge ids (already dropped from condensedEdges
    // but kept in edgesWithBackEdgeMarks so they can render inside the supernode).
    backEdgeIds = new Set<string>();
    for (const e of edgesWithBackEdgeMarks) {
      if (e.data?.isBackEdge === true) backEdgeIds.add(e.id);
    }
  } else {
    supernodes = [];
    memberToSupernode = new Map();
    backEdgeIds = detectBackEdges(layeringInputNodes, layeringInputEdges);
    edgesWithBackEdgeMarks = markBackEdges(layeringInputEdges, backEdgeIds);
    condensedNodes = layeringInputNodes;
    condensedEdges = edgesWithBackEdgeMarks;
  }

  // Semantic snapshot mirrors the whole filtered graph (internal + external +
  // SCC member edges) so debug panels and drilldown navigation see everything.
  const fullEdgesWithBackEdgeMarks = [...edgesWithBackEdgeMarks, ...externalIncidentEdges];
  const semanticSnapshot = { nodes: filteredGraph.nodes, edges: fullEdgesWithBackEdgeMarks };
  validateEdgesAgainstRegistry(condensedNodes, condensedEdges);

  // External-incident edges skipped SCC condensation (externals never participate
  // in cycles — they're sinks). Rejoin them into the downstream edge stream so
  // folder clustering, edge visibility, and bundling see them. Edges with an
  // external endpoint pass through liftCrossfolderEdgesToFolderLevel cleanly
  // because the external side has no parentNode.
  const downstreamEdges = [...condensedEdges, ...externalIncidentEdges];

  // Layering runs on the condensed internal graph (supernodes treated as regular nodes).
  const { weights: moduleWeights, traces: rankTraces } = computeModuleLayoutWeights(
    condensedNodes,
    condensedEdges,
    backEdgeIds
  );
  const layerAssignment = computeLayerAssignment(condensedNodes, condensedEdges, backEdgeIds);
  const sortOrder = computeBarycenterSortOrder(condensedNodes, condensedEdges, layerAssignment, backEdgeIds);

  // Apply layering results to the condensed nodes.
  const weightedCondensedNodes = applyModuleWeights(
    condensedNodes,
    moduleWeights,
    layerAssignment,
    sortOrder,
    rankTraces
  );

  // Tag each node with its population (plan §7.1). Internal modules get
  // 'internal'; SCC supernodes get 'scc'; externals (if partitioned out) get
  // 'external'. Rejoin externals here so folder clustering / edge visibility /
  // bundling all see the complete graph; layout positioning happens in
  // useGraphLayout (externals placed by layoutExternalBand).
  const taggedCondensedNodes = partitioned
    ? weightedCondensedNodes.map((node) =>
        annotateLayoutBand(node, node.type === 'scc' ? 'scc' : 'internal')
      )
    : weightedCondensedNodes;
  const taggedExternals = partitioned
    ? partitioned.external.map((node) => annotateLayoutBand(node, 'external'))
    : [];
  const weightedWithExternals = [...taggedCondensedNodes, ...taggedExternals];

  // Compute internal layouts for every supernode (relative to the supernode's
  // top-left corner). Downstream (Vue Flow parentNode) will translate these
  // into absolute coordinates. When there are no supernodes, this is a no-op.
  const nodesWithSccLayouts = attachSccInternalLayouts(
    weightedWithExternals,
    edgesWithBackEdgeMarks,
    supernodes
  );

  // Folder clustering runs on the CONDENSED node/edge set. SCC member nodes
  // and intra-SCC edges are hidden from this pass so the folder pipeline
  // sees a clean subgraph. We re-attach members and intra-SCC edges AFTER
  // all folder transforms, which keeps SCCs as siblings to modules at the
  // root level and preserves the original intra-SCC edges for rendering
  // (drawn inside the supernode).
  // TODO (plan §10): revisit if SCCs should live inside folders when all
  // members share a folder.
  const transformedGraph = applyGraphTransforms({ nodes: nodesWithSccLayouts, edges: downstreamEdges });

  const nodesWithFolderWeights = aggregateFolderWeights(transformedGraph.nodes);
  const edgesWithCrossfolderTypes = liftCrossfolderEdgesToFolderLevel(nodesWithFolderWeights, transformedGraph.edges);
  const nodesWithFolderLevelLayout = applyFolderLevelSugiyama(nodesWithFolderWeights, edgesWithCrossfolderTypes);

  // Re-attach SCC members as children of their supernodes plus the intra-SCC
  // edges that render inside the supernode. Member positions come from
  // layoutSCCInternal (relative to the supernode's top-left corner).
  let memberChildren: DependencyNode[] = [];
  let intraSccEdges: GraphEdge[] = [];
  if (useSccCondensation && supernodes.length > 0) {
    const supernodeById = new Map<string, DependencyNode>();
    for (const n of nodesWithFolderLevelLayout) if (n.type === 'scc') supernodeById.set(n.id, n);

    const addedChildren: DependencyNode[] = [];
    for (const sn of supernodes) {
      const parent = supernodeById.get(sn.id);
      if (!parent) continue;
      const rawPositions = parent.data?.sccMemberPositions;
      const positions =
        rawPositions && typeof rawPositions === 'object' ? (rawPositions as Record<string, { x: number; y: number }>) : {};
      for (const memberId of sn.members) {
        const original = filteredGraph.nodes.find((n) => n.id === memberId);
        if (!original) continue;
        const { extent: _removedExtent, ...nodeWithoutExtent } = original;
        const pos = positions[memberId] ?? { x: 0, y: 0 };
        addedChildren.push({
          ...nodeWithoutExtent,
          parentNode: sn.id,
          expandParent: true,
          position: pos,
          data: { ...(original.data ?? { label: original.id }), parentId: sn.id },
        } as DependencyNode);
      }
    }
    memberChildren = addedChildren;

    // Intra-SCC edges: lifted from the marked edge set. Their endpoints are
    // the original member ids, not the supernode id, so they render as edges
    // between siblings inside the supernode.
    intraSccEdges = edgesWithBackEdgeMarks.filter((e) => {
      const src = memberToSupernode.get(e.source);
      const tgt = memberToSupernode.get(e.target);
      return src !== undefined && src === tgt;
    });
  }

  let projectedGraph: GraphViewData = {
    nodes: [...nodesWithFolderLevelLayout, ...memberChildren],
    edges: [...edgesWithCrossfolderTypes, ...intraSccEdges],
  };
  if (options.collapsedFolderIds.size > 0) {
    const folderCollapsed = collapseFolders(projectedGraph.nodes, projectedGraph.edges, options.collapsedFolderIds);
    projectedGraph = { nodes: folderCollapsed.nodes, edges: folderCollapsed.edges };
  }

  const visibleEdges = applyEdgeVisibility(projectedGraph.edges, options.enabledRelationshipTypes);
  const bundledEdges = bundleParallelEdges(visibleEdges);
  const useFanInTrunks = options.useFanInTrunks ?? true;
  const trunkBundledEdges = useFanInTrunks
    ? bundleFanInTrunks(bundledEdges, projectedGraph.nodes)
    : bundledEdges;
  const currentDegreeMap = buildDegreeMap(projectedGraph.nodes, trunkBundledEdges, false);
  const globalDegreeMap = buildDegreeMap(unfilteredGraph.nodes, unfilteredGraph.edges, true);
  const nodesWithDiagnostics = annotateOrphanDiagnostics(projectedGraph.nodes, currentDegreeMap, globalDegreeMap);

  return {
    nodes: nodesWithDiagnostics,
    edges: trunkBundledEdges,
    semanticSnapshot,
  };
}
