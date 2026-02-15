/**
 * Symbol drilldown graph: expand a selected class/interface/module into members and usages.
 */

import { mapTypeCollection, typeCollectionToArray } from '../../utils/collections';
import { createEdgeMarker } from '../../utils/edgeMarkers';
import { getEdgeStyle, getNodeStyle } from '../../theme/graphTheme';
import { getHandlePositions } from '../handleRouting';
import { filterEdgesByNodeSet, applyEdgeVisibility } from '../graphViewShared';
import {
  findModuleById,
  toNodeProperty,
  toNodeMethod,
  createSymbolEdge,
} from './symbolHelpers';

import type { ClassStructure } from '../../types/ClassStructure';
import type { DependencyNode } from '../../types/DependencyNode';
import type { DependencyPackageGraph } from '../../types/DependencyPackageGraph';
import type { GraphEdge } from '../../types/GraphEdge';
import type { InterfaceStructure } from '../../types/InterfaceStructure';
import type { ModuleStructure } from '../../types/ModuleStructure';
import type { NodeMethod } from '../../types/NodeMethod';
import type { NodeProperty } from '../../types/NodeProperty';
import type { SymbolReferenceRef } from '../../types/SymbolReferenceRef';
import type { GraphViewData } from '../graphViewShared';

export interface BuildSymbolDrilldownGraphOptions {
  data: DependencyPackageGraph;
  selectedNode: DependencyNode;
  direction: 'LR' | 'RL' | 'TB' | 'BT';
  enabledRelationshipTypes: string[];
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
        if (classMatch) return { module, focusType: 'class', focusId: node.id };
      }
      if (node.type === 'interface' && module.interfaces) {
        const interfaceMatch = mapTypeCollection(module.interfaces, (iface) => iface).find(
          (iface) => iface.id === node.id
        );
        if (interfaceMatch) return { module, focusType: 'interface', focusId: node.id };
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
    data: { label, properties: [], methods: [] },
    style: { ...getNodeStyle(type), zIndex: 3 },
  } as DependencyNode;
}

function createUsageEdge(source: string, target: string, usageKind: 'method' | 'property'): GraphEdge {
  return {
    id: `${source}-${target}-uses-${usageKind}`,
    source,
    target,
    hidden: false,
    data: { type: 'uses', usageKind },
    style: {
      ...getEdgeStyle('import'),
      stroke: '#67e8f9',
      strokeWidth: 2,
      strokeDasharray: '4 2',
    },
    markerEnd: createEdgeMarker(),
  } as GraphEdge;
}

export function buildSymbolDrilldownGraph(options: BuildSymbolDrilldownGraphOptions): GraphViewData {
  const context = findSymbolContext(options.data, options.selectedNode);
  if (!context) {
    return { nodes: [options.selectedNode], edges: [] };
  }

  const { sourcePosition, targetPosition } = getHandlePositions(options.direction);
  const moduleId = context.module.id;
  const moduleName = context.module.name;
  const graphNodes: DependencyNode[] = [
    {
      id: moduleId,
      type: 'module',
      position: { x: 0, y: 0 },
      sourcePosition,
      targetPosition,
      data: { label: moduleName, properties: [] },
      style: { ...getNodeStyle('module'), borderColor: '#00ffff', borderWidth: '3px' },
    } as DependencyNode,
  ];
  const graphEdges: GraphEdge[] = [];
  const firstNode = graphNodes[0];
  if (firstNode === undefined) throw new Error('buildFocusGraph: expected at least one graph node');
  const nodeById = new Map<string, DependencyNode>([[moduleId, firstNode]]);
  const includeAllSymbols = context.focusType === 'module';
  const includedSymbolIds = new Set<string>();

  const addSymbol = (
    symbolId: string,
    type: 'class' | 'interface',
    label: string,
    properties: NodeProperty[],
    methods: NodeMethod[]
  ) => {
    if (nodeById.has(symbolId)) return;
    const symbolNode: DependencyNode = {
      id: symbolId,
      type,
      position: { x: 0, y: 0 },
      sourcePosition,
      targetPosition,
      data: { label, properties, methods },
      style: { ...getNodeStyle(type) },
    } as DependencyNode;
    graphNodes.push(symbolNode);
    nodeById.set(symbolId, symbolNode);
    includedSymbolIds.add(symbolId);
    graphEdges.push(createSymbolEdge(moduleId, symbolId, 'contains'));
    properties.forEach((property) => {
      const propertyId = property.id ?? `${symbolId}:property:${property.name}`;
      const memberNode = createMemberNode(propertyId, 'property', `${property.name}: ${property.type}`, options.direction);
      graphNodes.push(memberNode);
      nodeById.set(propertyId, memberNode);
      graphEdges.push(createSymbolEdge(symbolId, propertyId, 'contains'));
    });
    methods.forEach((method) => {
      const methodId = method.id ?? `${symbolId}:method:${method.name}`;
      const memberNode = createMemberNode(
        methodId,
        'method',
        `${method.name}(): ${method.returnType}`,
        options.direction
      );
      graphNodes.push(memberNode);
      nodeById.set(methodId, memberNode);
      graphEdges.push(createSymbolEdge(symbolId, methodId, 'contains'));
    });
  };

  if (context.module.classes) {
    mapTypeCollection(context.module.classes, (cls: ClassStructure) => {
      if (!includeAllSymbols && cls.id !== context.focusId) return;
      const properties = typeCollectionToArray(
        cls.properties as Record<string, NodeProperty> | NodeProperty[] | undefined
      ).map((p) => toNodeProperty(p));
      const methods = typeCollectionToArray(
        cls.methods as Record<string, NodeMethod> | NodeMethod[] | undefined
      ).map((m) => toNodeMethod(m));
      addSymbol(cls.id, 'class', cls.name, properties, methods);
    });
  }
  if (context.module.interfaces) {
    mapTypeCollection(context.module.interfaces, (iface: InterfaceStructure) => {
      if (!includeAllSymbols && iface.id !== context.focusId) return;
      const properties = typeCollectionToArray(
        iface.properties as Record<string, NodeProperty> | NodeProperty[] | undefined
      ).map((p) => toNodeProperty(p));
      const methods = typeCollectionToArray(
        iface.methods as Record<string, NodeMethod> | NodeMethod[] | undefined
      ).map((m) => toNodeMethod(m));
      addSymbol(iface.id, 'interface', iface.name, properties, methods);
    });
  }
  if (context.module.symbol_references) {
    mapTypeCollection(context.module.symbol_references, (reference: SymbolReferenceRef) => {
      const targetId = reference.target_symbol_id;
      const accessKind = reference.access_kind;
      const sourceId = reference.source_symbol_id ?? moduleId;
      if (!targetId || !nodeById.has(targetId)) return;
      if (!nodeById.has(sourceId)) return;
      if (!includeAllSymbols && sourceId !== context.focusId && !includedSymbolIds.has(sourceId)) return;
      graphEdges.push(createUsageEdge(sourceId, targetId, accessKind));
    });
  }

  const filteredEdges = filterEdgesByNodeSet(graphNodes, graphEdges);
  return {
    nodes: graphNodes,
    edges: applyEdgeVisibility(filteredEdges, options.enabledRelationshipTypes),
  };
}
