/**
 * Module drilldown graph: expand a selected module into classes/interfaces and connected modules.
 */

import { mapTypeCollection, typeCollectionToArray } from '../../utils/collections';
import { getHandlePositions } from '../handleRouting';
import { filterEdgesByNodeSet, applyEdgeVisibility } from '../graphViewShared';
import {
  findModuleById,
  toNodeProperty,
  toNodeMethod,
  createSymbolEdge,
  createDetailedSymbolNode,
} from './symbolHelpers';

import type { ClassStructure } from '../../types/ClassStructure';
import type { DependencyNode } from '../../types/DependencyNode';
import type { DependencyPackageGraph } from '../../types/DependencyPackageGraph';
import type { GraphEdge } from '../../types/GraphEdge';
import type { InterfaceRef } from '../../types/InterfaceRef';
import type { InterfaceStructure } from '../../types/InterfaceStructure';
import type { NodeMethod } from '../../types/NodeMethod';
import type { NodeProperty } from '../../types/NodeProperty';
import type { GraphViewData } from '../graphViewShared';

export interface BuildModuleDrilldownGraphOptions {
  data: DependencyPackageGraph;
  selectedNode: DependencyNode;
  currentNodes: DependencyNode[];
  currentEdges: GraphEdge[];
  direction: 'LR' | 'RL' | 'TB' | 'BT';
  enabledRelationshipTypes: string[];
}

export function buildModuleDrilldownGraph(options: BuildModuleDrilldownGraphOptions): GraphViewData {
  const moduleData = findModuleById(options.data, options.selectedNode.id);
  if (!moduleData) {
    return { nodes: [options.selectedNode], edges: [] };
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
    mapTypeCollection(moduleData.classes, (cls: ClassStructure) => {
      const properties = typeCollectionToArray(
        cls.properties as Record<string, NodeProperty> | NodeProperty[] | undefined
      ).map((p) => toNodeProperty(p));
      const methods = typeCollectionToArray(
        cls.methods as Record<string, NodeMethod> | NodeMethod[] | undefined
      ).map((m) => toNodeMethod(m));
      detailedNodes.push(
        createDetailedSymbolNode(cls.id, 'class', cls.name, properties, methods, options.direction)
      );
      if (cls.extends_id) detailedEdges.push(createSymbolEdge(cls.id, cls.extends_id, 'inheritance'));
      if (cls.implemented_interfaces) {
        mapTypeCollection(cls.implemented_interfaces, (iface: InterfaceRef) => {
          if (iface.id) detailedEdges.push(createSymbolEdge(cls.id, iface.id, 'implements'));
        });
      }
    });
  }

  if (moduleData.interfaces) {
    mapTypeCollection(moduleData.interfaces, (iface: InterfaceStructure) => {
      const properties = typeCollectionToArray(
        iface.properties as Record<string, NodeProperty> | NodeProperty[] | undefined
      ).map((p) => toNodeProperty(p));
      const methods = typeCollectionToArray(
        iface.methods as Record<string, NodeMethod> | NodeMethod[] | undefined
      ).map((m) => toNodeMethod(m));
      detailedNodes.push(
        createDetailedSymbolNode(iface.id, 'interface', iface.name, properties, methods, options.direction)
      );
      if (iface.extended_interfaces) {
        mapTypeCollection(iface.extended_interfaces, (extended: InterfaceRef) => {
          if (extended.id) detailedEdges.push(createSymbolEdge(iface.id, extended.id, 'inheritance'));
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
