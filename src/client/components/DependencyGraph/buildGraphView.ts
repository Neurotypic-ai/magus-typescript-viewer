import { MarkerType, Position } from '@vue-flow/core';

import { clusterByFolder } from '../../graph/cluster/folders';
import { collapseSccs } from '../../graph/cluster/scc';
import { getEdgeStyle, getNodeStyle } from '../../theme/graphTheme';
import { createGraphEdges } from '../../utils/createGraphEdges';
import { createGraphNodes } from '../../utils/createGraphNodes';
import { mapTypeCollection } from './mapTypeCollection';

import type {
  DependencyEdgeKind,
  DependencyNode,
  DependencyPackageGraph,
  GraphEdge,
  ModuleStructure,
  NodeMethod,
  NodeProperty,
} from './types';
import type { NodeChange } from '@vue-flow/core';

export interface GraphViewData {
  nodes: DependencyNode[];
  edges: GraphEdge[];
}

export interface BuildOverviewGraphOptions {
  data: DependencyPackageGraph;
  enabledNodeTypes: Iterable<string>;
  enabledRelationshipTypes: string[];
  direction: 'LR' | 'RL' | 'TB' | 'BT';
  clusterByFolder: boolean;
  collapseScc: boolean;
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

function getHandlePositions(direction: 'LR' | 'RL' | 'TB' | 'BT'): {
  sourcePosition: Position;
  targetPosition: Position;
} {
  switch (direction) {
    case 'LR':
      return { sourcePosition: Position.Right, targetPosition: Position.Left };
    case 'RL':
      return { sourcePosition: Position.Left, targetPosition: Position.Right };
    case 'TB':
      return { sourcePosition: Position.Bottom, targetPosition: Position.Top };
    case 'BT':
      return { sourcePosition: Position.Top, targetPosition: Position.Bottom };
  }
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
      result.push(group[0]!);
      continue;
    }

    // Pick the highest-priority edge as the visual representative
    group.sort((a, b) => {
      const prioA = EDGE_BUNDLE_PRIORITY[a.data?.type ?? ''] ?? 0;
      const prioB = EDGE_BUNDLE_PRIORITY[b.data?.type ?? ''] ?? 0;
      return prioB - prioA;
    });

    const representative = group[0]!;
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
    transformedNodes = collapsed.nodes as DependencyNode[];
    transformedEdges = collapsed.edges as GraphEdge[];
  }

  if (folderClusteringEnabled) {
    const clustered = clusterByFolder(transformedNodes, transformedEdges);
    transformedNodes = clustered.nodes as DependencyNode[];
    transformedEdges = clustered.edges as GraphEdge[];

    transformedNodes = transformedNodes.map((node) => ({
      ...node,
      draggable: node.type === 'group',
    }));
  }

  return {
    nodes: transformedNodes,
    edges: filterEdgesByNodeSet(transformedNodes, transformedEdges),
  };
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
        label: existingData.label ?? node.id,
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

  const transformedGraph = applyGraphTransforms(filteredGraph, {
    clusterByFolder: options.clusterByFolder,
    collapseScc: options.collapseScc,
  });

  const visibleEdges = applyEdgeVisibility(transformedGraph.edges, options.enabledRelationshipTypes);
  const bundledEdges = bundleParallelEdges(visibleEdges);
  const currentDegreeMap = buildDegreeMap(transformedGraph.nodes, bundledEdges, false);
  const globalDegreeMap = buildDegreeMap(unfilteredGraph.nodes, unfilteredGraph.edges, true);
  const nodesWithDiagnostics = annotateOrphanDiagnostics(transformedGraph.nodes, currentDegreeMap, globalDegreeMap);

  return {
    nodes: nodesWithDiagnostics,
    edges: bundledEdges,
  };
}

function toNodeProperty(property: NodeProperty | Record<string, unknown>): NodeProperty {
  return {
    id: typeof property.id === 'string' ? property.id : undefined,
    name: String(property.name ?? 'unknown'),
    type: String(property.type ?? 'unknown'),
    visibility: String(property.visibility ?? 'public'),
  };
}

function toNodeMethod(method: NodeMethod | Record<string, unknown>): NodeMethod {
  const methodName = String(method.name ?? 'unknown');
  const returnType = String(method.returnType ?? 'void');

  return {
    id: typeof method.id === 'string' ? method.id : undefined,
    name: methodName,
    returnType,
    visibility: String(method.visibility ?? 'public'),
    signature:
      typeof method.signature === 'string' && method.signature.length > 0
        ? method.signature
        : `${methodName}(): ${returnType}`,
  };
}

function createMarker() {
  return {
    type: MarkerType.ArrowClosed,
    width: 12,
    height: 12,
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
  options.currentEdges.forEach((edge) => {
    if (edge.source === options.selectedNode.id) {
      connectedModuleIds.add(edge.target);
      detailedEdges.push({
        ...edge,
        style: { ...edge.style, stroke: '#61dafb', strokeWidth: 3 },
        animated: true,
      } as GraphEdge);
    } else if (edge.target === options.selectedNode.id) {
      connectedModuleIds.add(edge.source);
      detailedEdges.push({
        ...edge,
        style: { ...edge.style, stroke: '#ffd700', strokeWidth: 3 },
        animated: true,
      } as GraphEdge);
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
  const nodeById = new Map<string, DependencyNode>([[context.module.id, graphNodes[0] as DependencyNode]]);

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

export function toDependencyEdgeKind(type: string | undefined): DependencyEdgeKind {
  if (
    type === 'dependency' ||
    type === 'devDependency' ||
    type === 'peerDependency' ||
    type === 'import' ||
    type === 'export' ||
    type === 'inheritance' ||
    type === 'implements' ||
    type === 'extends' ||
    type === 'contains' ||
    type === 'uses'
  ) {
    return type;
  }
  return 'dependency';
}

export function filterNodeChangesForFolderMode(
  changes: NodeChange[],
  nodes: DependencyNode[],
  folderModeEnabled: boolean
): NodeChange[] {
  if (!folderModeEnabled) {
    return changes;
  }

  const nodeTypeById = new Map(nodes.map((node) => [node.id, node.type]));

  return changes.filter((change) => {
    if (change.type === 'position' || change.type === 'dimensions') {
      return nodeTypeById.get(change.id) === 'group';
    }
    return true;
  });
}
