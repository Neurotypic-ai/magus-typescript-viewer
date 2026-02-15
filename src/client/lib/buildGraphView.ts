import { MarkerType } from '@vue-flow/core';

import { collapseFolders } from '../graph/cluster/collapseFolders';
import { clusterByFolder } from '../graph/cluster/folders';
import { collapseSccs } from '../graph/cluster/scc';
import { isValidEdgeConnection } from '../graph/edgeTypeRegistry';
import { applyEdgeHighways } from '../graph/transforms/edgeHighways';
import { EDGE_MARKER_HEIGHT_PX, EDGE_MARKER_WIDTH_PX } from '../layout/edgeGeometryPolicy';
import { getEdgeStyle, getNodeStyle } from '../theme/graphTheme';
import type {
  DependencyEdgeKind,
  DependencyKind,
  DependencyNode,
  DependencyPackageGraph,
  GraphEdge,
  ModuleStructure,
  NodeMethod,
  NodeProperty,
} from '../types';
import { createGraphEdges } from '../utils/createGraphEdges';
import { createGraphNodes } from '../utils/createGraphNodes';
import { getHandlePositions } from './graphUtils';
import { mapTypeCollection } from './mapTypeCollection';
import type { NodeChange } from '@vue-flow/core';

export interface GraphViewData {
  nodes: DependencyNode[];
  edges: GraphEdge[];
  semanticSnapshot?: { nodes: DependencyNode[]; edges: GraphEdge[] };
}

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

export interface BuildModuleDrilldownGraphOptions {
  data: DependencyPackageGraph;
  selectedNode: DependencyNode;
  currentNodes: DependencyNode[];
  currentEdges: GraphEdge[];
  direction: 'LR' | 'RL' | 'TB' | 'BT';
  enabledRelationshipTypes: string[];
}

export interface BuildSymbolDrilldownGraphOptions {
  data: DependencyPackageGraph;
  selectedNode: DependencyNode;
  direction: 'LR' | 'RL' | 'TB' | 'BT';
  enabledRelationshipTypes: string[];
}


function filterEdgesByNodeSet(nodes: DependencyNode[], edges: GraphEdge[]): GraphEdge[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
}

/** Priority for selecting the representative edge when bundling parallel edges. */
const EDGE_BUNDLE_PRIORITY: Record<string, number> = {
  contains: 5,
  uses: 5,
  inheritance: 4,
  implements: 3,
  extends: 3,
  dependency: 2,
  import: 1,
  devDependency: 0,
  peerDependency: 0,
  export: 0,
};

/**
 * Bundle parallel edges (same source → same target) into a single representative edge.
 * Reduces DOM element count by 20-40% in graphs with multiple relationship types.
 * Skips bundling for small graphs where the overhead isn't worth it.
 */
function bundleParallelEdges(edges: GraphEdge[]): GraphEdge[] {
  if (edges.length < 50) return edges;

  const edgeGroups = new Map<string, GraphEdge[]>();

  for (const edge of edges) {
    const key = `${edge.source}\0${edge.target}`;
    const group = edgeGroups.get(key);
    if (group) {
      group.push(edge);
    } else {
      edgeGroups.set(key, [edge]);
    }
  }

  const result: GraphEdge[] = [];

  for (const group of edgeGroups.values()) {
    if (group.length === 1) {
      const sole = group[0];
      if (sole) result.push(sole);
      continue;
    }

    // Preserve highway trunk groups as-is to avoid blending trunk semantics
    // with any non-highway visual edges sharing the same source/target pair.
    if (group.some((edge) => edge.data?.highwaySegment === 'highway')) {
      result.push(...group);
      continue;
    }

    // Pick the highest-priority edge as the visual representative
    group.sort((a, b) => {
      const prioA = EDGE_BUNDLE_PRIORITY[a.data?.type ?? ''] ?? 0;
      const prioB = EDGE_BUNDLE_PRIORITY[b.data?.type ?? ''] ?? 0;
      return prioB - prioA;
    });

    const representative = group[0];
    if (!representative) continue;
    const bundledTypes = [
      ...new Set(group.map((e) => e.data?.type).filter((t): t is DependencyEdgeKind => t !== undefined)),
    ];

    // Bundle is visible if ANY edge in the group is visible (not hidden).
    // This prevents the representative's hidden state from suppressing
    // visible lower-priority edges in the same source→target pair.
    const anyVisible = group.some((e) => !e.hidden);

    result.push({
      ...representative,
      hidden: !anyVisible,
      data: {
        ...representative.data,
        bundledCount: group.length,
        bundledTypes,
      },
    });
  }

  return result;
}

export function applyEdgeVisibility(edges: GraphEdge[], enabledRelationshipTypes: string[]): GraphEdge[] {
  const enabledTypes = new Set(enabledRelationshipTypes);

  return edges.map((edge) => {
    const type = edge.data?.type;

    // Uses edges are drill-down edges and should remain visible even when
    // relationship controls are focused on top-level dependency types.
    if (type === 'uses' || type === 'contains') {
      return {
        ...edge,
        hidden: false,
      };
    }

    if (!type) {
      return {
        ...edge,
        hidden: false,
      };
    }

    return {
      ...edge,
      hidden: !enabledTypes.has(type),
    };
  });
}

function applyGraphTransforms(
  graphData: GraphViewData,
  options: Pick<BuildOverviewGraphOptions, 'clusterByFolder' | 'collapseScc'>
): GraphViewData {
  let transformedNodes = graphData.nodes;
  let transformedEdges = graphData.edges;

  const folderClusteringEnabled = options.clusterByFolder;

  // Folder mode and SCC collapse both rewrite parent relationships.
  // Folder mode is deterministic and takes precedence when enabled.
  if (!folderClusteringEnabled && options.collapseScc) {
    const collapsed = collapseSccs(transformedNodes, transformedEdges);
    transformedNodes = collapsed.nodes;
    transformedEdges = collapsed.edges;
  }

  if (folderClusteringEnabled) {
    const clustered = clusterByFolder(transformedNodes, transformedEdges);
    transformedNodes = clustered.nodes;
    transformedEdges = clustered.edges;

    // All nodes remain draggable in folder mode — group nodes can be
    // dragged freely and children move with their parent via Vue Flow's
    // built-in compound node behaviour.
  }

  return {
    nodes: transformedNodes,
    edges: filterEdgesByNodeSet(transformedNodes, transformedEdges),
  };
}

function validateEdgesAgainstRegistry(nodes: DependencyNode[], edges: GraphEdge[]): void {
  if (!import.meta.env.DEV) {
    return;
  }

  const kindByNodeId = new Map<string, DependencyKind>();
  for (const node of nodes) {
    if (node.type) {
      kindByNodeId.set(node.id, node.type as DependencyKind);
    }
  }

  edges.forEach((edge) => {
    const kind = edge.data?.type;
    if (!kind) return;

    const sourceKind = kindByNodeId.get(edge.source);
    const targetKind = kindByNodeId.get(edge.target);
    if (!sourceKind || !targetKind) return;

    if (!isValidEdgeConnection(kind, sourceKind, targetKind)) {
      console.warn('[buildGraphView] Edge kind and endpoint kinds do not match registry', {
        edgeId: edge.id,
        kind,
        source: edge.source,
        sourceKind,
        target: edge.target,
        targetKind,
      });
    }
  });
}

function filterGraphByTestVisibility(graphData: GraphViewData, hideTestFiles: boolean): GraphViewData {
  if (!hideTestFiles) {
    return graphData;
  }

  const filteredNodes = graphData.nodes.filter((node) => node.data?.diagnostics?.isTestFile !== true);
  return {
    nodes: filteredNodes,
    edges: filterEdgesByNodeSet(filteredNodes, graphData.edges),
  };
}

function buildDegreeMap(nodes: DependencyNode[], edges: GraphEdge[], includeHiddenEdges = false): Map<string, number> {
  const degreeMap = new Map<string, number>();
  nodes.forEach((node) => degreeMap.set(node.id, 0));

  edges.forEach((edge) => {
    if (!includeHiddenEdges && edge.hidden) {
      return;
    }

    if (degreeMap.has(edge.source)) {
      degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    }
    if (degreeMap.has(edge.target)) {
      degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
    }
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

  // In compact mode, class/interface VueFlow nodes don't exist, so class-level
  // edges (inheritance, implements) would have dangling targets — skip them.
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
      const folderCollapsed = collapseFolders(projectedGraph.nodes, projectedGraph.edges, options.collapsedFolderIds);
      projectedGraph = {
        nodes: folderCollapsed.nodes,
        edges: folderCollapsed.edges,
      };
    }
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

function toNodeProperty(property: NodeProperty | Record<string, unknown>): NodeProperty {
  const name = property.name;
  const type = property.type;
  const visibility = property.visibility;
  return {
    id: typeof property.id === 'string' ? property.id : undefined,
    name: typeof name === 'string' ? name : 'unknown',
    type: typeof type === 'string' ? type : 'unknown',
    visibility: typeof visibility === 'string' ? visibility : 'public',
  };
}

function toNodeMethod(method: NodeMethod | Record<string, unknown>): NodeMethod {
  const name = method.name;
  const returnTypeVal = method.returnType;
  const visibility = method.visibility;
  const methodName = typeof name === 'string' ? name : 'unknown';
  const returnType = typeof returnTypeVal === 'string' ? returnTypeVal : 'void';

  return {
    id: typeof method.id === 'string' ? method.id : undefined,
    name: methodName,
    returnType,
    visibility: typeof visibility === 'string' ? visibility : 'public',
    signature:
      typeof method.signature === 'string' && method.signature.length > 0
        ? method.signature
        : `${methodName}(): ${returnType}`,
  };
}

function createMarker() {
  return {
    type: MarkerType.ArrowClosed,
    width: EDGE_MARKER_WIDTH_PX,
    height: EDGE_MARKER_HEIGHT_PX,
  };
}

function findModuleById(data: DependencyPackageGraph, moduleId: string): ModuleStructure | undefined {
  for (const pkg of data.packages) {
    if (!pkg.modules) continue;
    const module = mapTypeCollection(pkg.modules, (entry) => entry).find((entry) => entry.id === moduleId);
    if (module) {
      return module;
    }
  }
  return undefined;
}

function createSymbolEdge(source: string, target: string, type: DependencyEdgeKind): GraphEdge {
  return {
    id: `${source}-${target}-${type}`,
    source,
    target,
    hidden: false,
    data: { type },
    style: { ...getEdgeStyle(type), strokeWidth: 3 },
    markerEnd: createMarker(),
  } as GraphEdge;
}

function toRecordOrArray<T>(collection: Record<string, T> | T[] | undefined): T[] {
  if (!collection) {
    return [];
  }
  if (Array.isArray(collection)) {
    return collection;
  }
  return Object.values(collection);
}

function createDetailedSymbolNode(
  id: string,
  type: 'class' | 'interface',
  label: string,
  properties: NodeProperty[],
  methods: NodeMethod[],
  direction: 'LR' | 'RL' | 'TB' | 'BT'
): DependencyNode {
  const { sourcePosition, targetPosition } = getHandlePositions(direction);

  return {
    id,
    type,
    position: { x: 0, y: 0 },
    sourcePosition,
    targetPosition,
    data: {
      label,
      properties,
      methods,
    },
    style: {
      ...getNodeStyle(type),
    },
  } as DependencyNode;
}

export function buildModuleDrilldownGraph(options: BuildModuleDrilldownGraphOptions): GraphViewData {
  const moduleData = findModuleById(options.data, options.selectedNode.id);
  if (!moduleData) {
    return {
      nodes: [options.selectedNode],
      edges: [],
    };
  }

  const detailedNodes: DependencyNode[] = [];
  const detailedEdges: GraphEdge[] = [];
  const { sourcePosition, targetPosition } = getHandlePositions(options.direction);

  detailedNodes.push({
    ...options.selectedNode,
    sourcePosition,
    targetPosition,
    style: {
      ...(typeof options.selectedNode.style === 'object' ? options.selectedNode.style : {}),
      borderWidth: '3px',
      borderColor: '#00ffff',
    },
  });

  if (moduleData.classes) {
    mapTypeCollection(moduleData.classes, (cls) => {
      const properties = toRecordOrArray(cls.properties as Record<string, NodeProperty> | NodeProperty[] | undefined).map(
        (property) => toNodeProperty(property)
      );
      const methods = toRecordOrArray(cls.methods as Record<string, NodeMethod> | NodeMethod[] | undefined).map((method) =>
        toNodeMethod(method)
      );

      detailedNodes.push(
        createDetailedSymbolNode(cls.id, 'class', cls.name, properties, methods, options.direction)
      );

      if (cls.extends_id) {
        detailedEdges.push(createSymbolEdge(cls.id, cls.extends_id, 'inheritance'));
      }

      if (cls.implemented_interfaces) {
        mapTypeCollection(cls.implemented_interfaces, (iface) => {
          if (!iface.id) return;
          detailedEdges.push(createSymbolEdge(cls.id, iface.id, 'implements'));
        });
      }
    });
  }

  if (moduleData.interfaces) {
    mapTypeCollection(moduleData.interfaces, (iface) => {
      const properties = toRecordOrArray(
        iface.properties as Record<string, NodeProperty> | NodeProperty[] | undefined
      ).map((property) => toNodeProperty(property));
      const methods = toRecordOrArray(iface.methods as Record<string, NodeMethod> | NodeMethod[] | undefined).map((method) =>
        toNodeMethod(method)
      );

      detailedNodes.push(
        createDetailedSymbolNode(iface.id, 'interface', iface.name, properties, methods, options.direction)
      );

      if (iface.extended_interfaces) {
        mapTypeCollection(iface.extended_interfaces, (extended) => {
          if (!extended.id) return;
          detailedEdges.push(createSymbolEdge(iface.id, extended.id, 'inheritance'));
        });
      }
    });
  }

  const connectedModuleIds = new Set<string>();
  const resolveStyle = (edge: GraphEdge): Record<string, unknown> => {
    const s = edge.style;
    return typeof s === 'function' ? (s as () => Record<string, unknown>)() : (s ?? {});
  };
  options.currentEdges.forEach((edge) => {
    if (edge.source === options.selectedNode.id) {
      connectedModuleIds.add(edge.target);
      detailedEdges.push({
        ...edge,
        style: { ...resolveStyle(edge), stroke: '#61dafb', strokeWidth: 3 },
        animated: true,
      });
    } else if (edge.target === options.selectedNode.id) {
      connectedModuleIds.add(edge.source);
      detailedEdges.push({
        ...edge,
        style: { ...resolveStyle(edge), stroke: '#ffd700', strokeWidth: 3 },
        animated: true,
      });
    }
  });

  connectedModuleIds.forEach((moduleId) => {
    const connectedModule = options.currentNodes.find((node) => node.id === moduleId);
    if (!connectedModule) return;

    detailedNodes.push({
      ...connectedModule,
      sourcePosition,
      targetPosition,
      style: {
        ...(typeof connectedModule.style === 'object' ? connectedModule.style : {}),
        borderWidth: '2px',
        borderColor: '#61dafb',
      },
    });
  });

  const filteredEdges = filterEdgesByNodeSet(detailedNodes, detailedEdges);

  return {
    nodes: detailedNodes,
    edges: applyEdgeVisibility(filteredEdges, options.enabledRelationshipTypes),
  };
}

interface SymbolContext {
  module: ModuleStructure;
  focusType: 'module' | 'class' | 'interface';
  focusId: string;
}

function findSymbolContext(data: DependencyPackageGraph, node: DependencyNode): SymbolContext | undefined {
  if (node.type === 'module') {
    const module = findModuleById(data, node.id);
    if (!module) return undefined;
    return { module, focusType: 'module', focusId: node.id };
  }

  for (const pkg of data.packages) {
    if (!pkg.modules) continue;

    for (const module of mapTypeCollection(pkg.modules, (entry) => entry)) {
      if (node.type === 'class' && module.classes) {
        const classMatch = mapTypeCollection(module.classes, (cls) => cls).find((cls) => cls.id === node.id);
        if (classMatch) {
          return { module, focusType: 'class', focusId: node.id };
        }
      }

      if (node.type === 'interface' && module.interfaces) {
        const interfaceMatch = mapTypeCollection(module.interfaces, (iface) => iface).find((iface) => iface.id === node.id);
        if (interfaceMatch) {
          return { module, focusType: 'interface', focusId: node.id };
        }
      }
    }
  }

  return undefined;
}

function createMemberNode(
  id: string,
  type: 'property' | 'method',
  label: string,
  direction: 'LR' | 'RL' | 'TB' | 'BT'
): DependencyNode {
  const { sourcePosition, targetPosition } = getHandlePositions(direction);

  return {
    id,
    type,
    position: { x: 0, y: 0 },
    sourcePosition,
    targetPosition,
    data: {
      label,
      properties: [],
      methods: [],
    },
    style: {
      ...getNodeStyle(type),
      zIndex: 3,
    },
  } as DependencyNode;
}

function createUsageEdge(source: string, target: string, usageKind: 'method' | 'property'): GraphEdge {
  return {
    id: `${source}-${target}-uses-${usageKind}`,
    source,
    target,
    hidden: false,
    data: {
      type: 'uses',
      usageKind,
    },
    style: {
      ...getEdgeStyle('import'),
      stroke: '#67e8f9',
      strokeWidth: 2,
      strokeDasharray: '4 2',
    },
    markerEnd: createMarker(),
  } as GraphEdge;
}

export function buildSymbolDrilldownGraph(options: BuildSymbolDrilldownGraphOptions): GraphViewData {
  const context = findSymbolContext(options.data, options.selectedNode);
  if (!context) {
    return {
      nodes: [options.selectedNode],
      edges: [],
    };
  }

  const { sourcePosition, targetPosition } = getHandlePositions(options.direction);

  const graphNodes: DependencyNode[] = [
    {
      id: context.module.id,
      type: 'module',
      position: { x: 0, y: 0 },
      sourcePosition,
      targetPosition,
      data: {
        label: context.module.name,
        properties: [],
      },
      style: {
        ...getNodeStyle('module'),
        borderColor: '#00ffff',
        borderWidth: '3px',
      },
    } as DependencyNode,
  ];

  const graphEdges: GraphEdge[] = [];
  const firstNode = graphNodes[0];
  if (firstNode === undefined) throw new Error('buildFocusGraph: expected at least one graph node');
  const nodeById = new Map<string, DependencyNode>([[context.module.id, firstNode]]);

  const includeAllSymbols = context.focusType === 'module';
  const includedSymbolIds = new Set<string>();

  const addSymbol = (symbolId: string, type: 'class' | 'interface', label: string, properties: NodeProperty[], methods: NodeMethod[]) => {
    if (nodeById.has(symbolId)) return;

    const symbolNode: DependencyNode = {
      id: symbolId,
      type,
      position: { x: 0, y: 0 },
      sourcePosition,
      targetPosition,
      data: {
        label,
        properties,
        methods,
      },
      style: {
        ...getNodeStyle(type),
      },
    } as DependencyNode;

    graphNodes.push(symbolNode);
    nodeById.set(symbolId, symbolNode);
    includedSymbolIds.add(symbolId);

    graphEdges.push(createSymbolEdge(context.module.id, symbolId, 'contains'));

    properties.forEach((property) => {
      const propertyId = property.id ?? `${symbolId}:property:${property.name}`;
      const memberNode = createMemberNode(propertyId, 'property', `${property.name}: ${property.type}`, options.direction);
      graphNodes.push(memberNode);
      nodeById.set(propertyId, memberNode);
      graphEdges.push(createSymbolEdge(symbolId, propertyId, 'contains'));
    });

    methods.forEach((method) => {
      const methodId = method.id ?? `${symbolId}:method:${method.name}`;
      const memberNode = createMemberNode(methodId, 'method', `${method.name}(): ${method.returnType}`, options.direction);
      graphNodes.push(memberNode);
      nodeById.set(methodId, memberNode);
      graphEdges.push(createSymbolEdge(symbolId, methodId, 'contains'));
    });
  };

  if (context.module.classes) {
    mapTypeCollection(context.module.classes, (cls) => {
      if (!includeAllSymbols && cls.id !== context.focusId) {
        return;
      }

      const properties = toRecordOrArray(cls.properties as Record<string, NodeProperty> | NodeProperty[] | undefined).map(
        (property) => toNodeProperty(property)
      );
      const methods = toRecordOrArray(cls.methods as Record<string, NodeMethod> | NodeMethod[] | undefined).map((method) =>
        toNodeMethod(method)
      );
      addSymbol(cls.id, 'class', cls.name, properties, methods);
    });
  }

  if (context.module.interfaces) {
    mapTypeCollection(context.module.interfaces, (iface) => {
      if (!includeAllSymbols && iface.id !== context.focusId) {
        return;
      }

      const properties = toRecordOrArray(
        iface.properties as Record<string, NodeProperty> | NodeProperty[] | undefined
      ).map((property) => toNodeProperty(property));
      const methods = toRecordOrArray(iface.methods as Record<string, NodeMethod> | NodeMethod[] | undefined).map((method) =>
        toNodeMethod(method)
      );
      addSymbol(iface.id, 'interface', iface.name, properties, methods);
    });
  }

  if (context.module.symbol_references) {
    mapTypeCollection(context.module.symbol_references, (reference) => {
      const targetId = reference.target_symbol_id;
      const accessKind = reference.access_kind;
      const sourceId = reference.source_symbol_id ?? context.module.id;

      if (!targetId || !nodeById.has(targetId)) return;
      if (!nodeById.has(sourceId)) return;
      if (!includeAllSymbols && sourceId !== context.focusId && !includedSymbolIds.has(sourceId)) {
        return;
      }

      graphEdges.push(createUsageEdge(sourceId, targetId, accessKind));
    });
  }

  const filteredEdges = filterEdgesByNodeSet(graphNodes, graphEdges);

  return {
    nodes: graphNodes,
    edges: applyEdgeVisibility(filteredEdges, options.enabledRelationshipTypes),
  };
}

export { toDependencyEdgeKind } from './edgeKindUtils';

export function filterNodeChangesForFolderMode(
  changes: NodeChange[],
  _nodes: DependencyNode[],
  folderModeEnabled: boolean
): NodeChange[] {
  if (!folderModeEnabled) {
    return changes;
  }

  // In folder mode all position/dimension changes are allowed — Vue Flow
  // handles compound node parent↔child movement natively.
  return changes;
}
