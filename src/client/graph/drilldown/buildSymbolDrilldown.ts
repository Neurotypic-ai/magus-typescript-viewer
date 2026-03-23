/**
 * Symbol drilldown graph: expand a selected class/interface/module into members and usages.
 */

import { getEdgeStyle, getNodeStyle, graphTheme } from '../../theme/graphTheme';
import { cssVar, graphCssVariableNames } from '../../theme/graphTokens';
import { mapTypeCollection, typeCollectionToArray } from '../../utils/collections';
import { createEdgeMarker } from '../../utils/edgeMarkers';
import { applyEdgeVisibility, filterEdgesByNodeSet } from '../graphViewShared';
import { getHandlePositions } from '../handleRouting';
import { createSymbolEdge, findModuleById, normalizeMethod, normalizeProperty } from './symbolHelpers';

import type { Class } from '../../../shared/types/Class';
import type { Interface } from '../../../shared/types/Interface';
import type { Method } from '../../../shared/types/Method';
import type { Module } from '../../../shared/types/Module';
import type { PackageGraph } from '../../../shared/types/Package';
import type { Property } from '../../../shared/types/Property';
import type { SymbolReference } from '../../../shared/types/SymbolReference';
import type { DependencyNode } from '../../types/DependencyNode';
import type { GraphEdge } from '../../types/GraphEdge';
import type { GraphViewData } from '../graphViewShared';

export interface BuildSymbolDrilldownGraphOptions {
  data: PackageGraph;
  selectedNode: DependencyNode;
  direction: 'LR' | 'RL' | 'TB' | 'BT';
  enabledRelationshipTypes: string[];
}

interface SymbolContext {
  module: Module;
  focusType: 'module' | 'class' | 'interface';
  focusId: string;
}

function findSymbolContext(data: PackageGraph, node: DependencyNode): SymbolContext | undefined {
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
      ...getEdgeStyle('uses'),
      stroke: cssVar(graphCssVariableNames.edgeKinds.import.color),
      strokeWidth: graphTheme.edges.sizes.width.isolated,
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
      style: {
        ...getNodeStyle('module'),
        borderColor: cssVar(graphCssVariableNames.selection.targetBorder),
        borderWidth: `${String(graphTheme.edges.sizes.width.highlighted)}px`,
      },
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
    properties: Property[],
    methods: Method[]
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
      const memberNode = createMemberNode(
        propertyId,
        'property',
        `${property.name}: ${property.type}`,
        options.direction
      );
      graphNodes.push(memberNode);
      nodeById.set(propertyId, memberNode);
      graphEdges.push(createSymbolEdge(symbolId, propertyId, 'contains'));
    });
    methods.forEach((method) => {
      const methodId = method.id ?? `${symbolId}:method:${method.name}`;
      const memberNode = createMemberNode(
        methodId,
        'method',
        `${method.name}(): ${method.return_type}`,
        options.direction
      );
      graphNodes.push(memberNode);
      nodeById.set(methodId, memberNode);
      graphEdges.push(createSymbolEdge(symbolId, methodId, 'contains'));
    });
  };

  if (context.module.classes) {
    mapTypeCollection(context.module.classes, (cls: Class) => {
      if (!includeAllSymbols && cls.id !== context.focusId) return;
      const properties = typeCollectionToArray(cls.properties as Record<string, Property> | Property[] | undefined).map(
        (p) => normalizeProperty(p)
      );
      const methods = typeCollectionToArray(cls.methods as Record<string, Method> | Method[] | undefined).map((m) =>
        normalizeMethod(m)
      );
      addSymbol(cls.id, 'class', cls.name, properties, methods);
    });
  }
  if (context.module.interfaces) {
    mapTypeCollection(context.module.interfaces, (iface: Interface) => {
      if (!includeAllSymbols && iface.id !== context.focusId) return;
      const properties = typeCollectionToArray(
        iface.properties as Record<string, Property> | Property[] | undefined
      ).map((p) => normalizeProperty(p));
      const methods = typeCollectionToArray(iface.methods as Record<string, Method> | Method[] | undefined).map((m) =>
        normalizeMethod(m)
      );
      addSymbol(iface.id, 'interface', iface.name, properties, methods);
    });
  }
  if (context.module.symbol_references) {
    mapTypeCollection(context.module.symbol_references, (reference: SymbolReference) => {
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
