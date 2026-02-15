import { createEdgeMarker } from './edgeMarkers';
import { isValidEdgeConnection } from '../graph/edgeTypeRegistry';
import { mapTypeCollection, typeCollectionToArray } from './collections';
import { getEdgeStyle } from '../theme/graphTheme';
import { buildModulePathLookup, isExternalImportRef, resolveModuleId } from './graphEdgeLookups';

import type { ClassStructure } from '../types/ClassStructure';
import type { DependencyEdgeKind } from '../types/DependencyEdgeKind';
import type { DependencyKind } from '../types/DependencyKind';
import type { DependencyPackageGraph } from '../types/DependencyPackageGraph';
import type { DependencyRef } from '../types/DependencyRef';
import type { GraphEdge } from '../types/GraphEdge';
import type { ImportRef } from '../types/ImportRef';
import type { InterfaceRef } from '../types/InterfaceRef';
import type { InterfaceStructure } from '../types/InterfaceStructure';
import type { ModuleStructure } from '../types/ModuleStructure';
import type { NodeMethod } from '../types/NodeMethod';
import type { NodeProperty } from '../types/NodeProperty';
import type { PackageStructure } from '../types/PackageStructure';

type ImportDirection = 'importer-to-imported' | 'imported-to-importer';
const EDGE_REGISTRY_DEBUG =
  import.meta.env.DEV && (import.meta.env['VITE_DEBUG_EDGE_REGISTRY'] as string | undefined) === 'true';
const EDGE_REGISTRY_DEBUG_SAMPLE_LIMIT = 5;

export interface CreateGraphEdgesOptions {
  includePackageEdges?: boolean;
  includeClassEdges?: boolean;
  // Backward-compatible alias for includeClassEdges
  includeSymbolEdges?: boolean;
  includeMemberContainmentEdges?: boolean;
  liftClassEdgesToModuleLevel?: boolean;
  importDirection?: ImportDirection;
}

interface ResolvedOptions {
  includePackageEdges: boolean;
  includeClassEdges: boolean;
  includeMemberContainmentEdges: boolean;
  liftClassEdgesToModuleLevel: boolean;
  importDirection: ImportDirection;
}


function buildNodeIdSet(data: DependencyPackageGraph, options: ResolvedOptions): Set<string> {
  const nodeIds = new Set<string>();

  data.packages.forEach((pkg: PackageStructure) => {
    if (options.includePackageEdges) {
      nodeIds.add(pkg.id);
    }

    if (!pkg.modules) {
      return;
    }

    mapTypeCollection(pkg.modules, (module: ModuleStructure) => {
      nodeIds.add(module.id);

      if (!options.includeClassEdges) {
        return;
      }

      if (module.classes) {
        mapTypeCollection(module.classes, (cls: ClassStructure) => {
          nodeIds.add(cls.id);
          if (options.includeMemberContainmentEdges) {
            typeCollectionToArray(cls.properties as Record<string, NodeProperty> | NodeProperty[]).forEach((property: NodeProperty) => {
              const propertyId = property.id ?? `${cls.id}:property:${property.name}`;
              nodeIds.add(propertyId);
            });
            typeCollectionToArray(cls.methods as Record<string, NodeMethod> | NodeMethod[]).forEach((method: NodeMethod) => {
              const methodId = method.id ?? `${cls.id}:method:${method.name}`;
              nodeIds.add(methodId);
            });
          }
        });
      }

      if (module.interfaces) {
        mapTypeCollection(module.interfaces, (iface: InterfaceStructure) => {
          nodeIds.add(iface.id);
          if (options.includeMemberContainmentEdges) {
            typeCollectionToArray(
              iface.properties as Record<string, NodeProperty> | NodeProperty[]
            ).forEach((property: NodeProperty) => {
              const propertyId = property.id ?? `${iface.id}:property:${property.name}`;
              nodeIds.add(propertyId);
            });
            typeCollectionToArray(
              iface.methods as Record<string, NodeMethod> | NodeMethod[]
            ).forEach((method: NodeMethod) => {
              const methodId = method.id ?? `${iface.id}:method:${method.name}`;
              nodeIds.add(methodId);
            });
          }
        });
      }
    });
  });

  return nodeIds;
}

function buildNodeKindLookup(data: DependencyPackageGraph, options: ResolvedOptions): Map<string, DependencyKind> {
  const nodeKinds = new Map<string, DependencyKind>();

  data.packages.forEach((pkg: PackageStructure) => {
    if (options.includePackageEdges) {
      nodeKinds.set(pkg.id, 'package');
    }

    if (!pkg.modules) {
      return;
    }

    mapTypeCollection(pkg.modules, (module: ModuleStructure) => {
      nodeKinds.set(module.id, 'module');

      if (!options.includeClassEdges) {
        return;
      }

      if (module.classes) {
        mapTypeCollection(module.classes, (cls: ClassStructure) => {
          nodeKinds.set(cls.id, 'class');

          if (!options.includeMemberContainmentEdges) {
            return;
          }

          typeCollectionToArray(
            cls.properties as Record<string, NodeProperty> | NodeProperty[]
          ).forEach((property: NodeProperty) => {
            const propertyId = property.id ?? `${cls.id}:property:${property.name}`;
            nodeKinds.set(propertyId, 'property');
          });

          typeCollectionToArray(
            cls.methods as Record<string, NodeMethod> | NodeMethod[]
          ).forEach((method: NodeMethod) => {
            const methodId = method.id ?? `${cls.id}:method:${method.name}`;
            nodeKinds.set(methodId, 'method');
          });
        });
      }

      if (module.interfaces) {
        mapTypeCollection(module.interfaces, (iface: InterfaceStructure) => {
          nodeKinds.set(iface.id, 'interface');

          if (!options.includeMemberContainmentEdges) {
            return;
          }

          typeCollectionToArray(
            iface.properties as Record<string, NodeProperty> | NodeProperty[]
          ).forEach((property: NodeProperty) => {
            const propertyId = property.id ?? `${iface.id}:property:${property.name}`;
            nodeKinds.set(propertyId, 'property');
          });

          typeCollectionToArray(
            iface.methods as Record<string, NodeMethod> | NodeMethod[]
          ).forEach((method: NodeMethod) => {
            const methodId = method.id ?? `${iface.id}:method:${method.name}`;
            nodeKinds.set(methodId, 'method');
          });
        });
      }
    });
  });

  return nodeKinds;
}

function buildSymbolToModuleMap(data: DependencyPackageGraph): Map<string, string> {
  const symbolToModuleMap = new Map<string, string>();

  data.packages.forEach((pkg: PackageStructure) => {
    if (!pkg.modules) {
      return;
    }

    mapTypeCollection(pkg.modules, (module: ModuleStructure) => {
      const moduleId = module.id;
      if (module.classes) {
        mapTypeCollection(module.classes, (cls: ClassStructure) => {
          symbolToModuleMap.set(cls.id, moduleId);
        });
      }

      if (module.interfaces) {
        mapTypeCollection(module.interfaces, (iface: InterfaceStructure) => {
          symbolToModuleMap.set(iface.id, moduleId);
        });
      }
    });
  });

  return symbolToModuleMap;
}


function createEdge(
  source: string,
  target: string,
  type: DependencyEdgeKind,
  importName?: string,
  sourceHandle?: string,
  targetHandle?: string
): GraphEdge {
  return {
    id: `${source}-${target}-${type}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    hidden: false,
    data: {
      type,
      ...(importName ? { importName } : {}),
    },
    style: getEdgeStyle(type),
    markerEnd: createEdgeMarker(),
  } as GraphEdge;
}

function addLiftedModuleEdges(
  classEdges: GraphEdge[],
  symbolToModuleMap: Map<string, string>,
  addEdge: (edge: GraphEdge, keyOverride?: string) => void
): void {
  classEdges.forEach((edge: GraphEdge) => {
    const type: DependencyEdgeKind | undefined = edge.data?.type;
    if (!type) return;

    const sourceModuleId = symbolToModuleMap.get(edge.source);
    const targetModuleId = symbolToModuleMap.get(edge.target);
    if (!sourceModuleId || !targetModuleId) return;
    if (sourceModuleId === targetModuleId) return;

    addEdge(
      createEdge(sourceModuleId, targetModuleId, type),
      `${sourceModuleId}|${targetModuleId}|${type}|lifted`
    );
  });
}

/**
 * Creates graph edges from the provided dependency package graph data.
 */
export function createGraphEdges(
  data: DependencyPackageGraph,
  options: CreateGraphEdgesOptions = {}
): GraphEdge[] {
  const resolvedOptions: ResolvedOptions = {
    includePackageEdges: options.includePackageEdges ?? false,
    includeClassEdges: options.includeClassEdges ?? options.includeSymbolEdges ?? false,
    includeMemberContainmentEdges: options.includeMemberContainmentEdges ?? false,
    liftClassEdgesToModuleLevel: options.liftClassEdgesToModuleLevel ?? false,
    importDirection: options.importDirection ?? 'importer-to-imported',
  };

  const lookup = buildModulePathLookup(data);
  const validNodeIds = buildNodeIdSet(data, resolvedOptions);
  const nodeKindsById = buildNodeKindLookup(data, resolvedOptions);
  const symbolToModuleMap = buildSymbolToModuleMap(data);
  const edgeMap = new Map<string, GraphEdge>();
  const classRelationshipEdges: GraphEdge[] = [];
  let invalidEdgeRegistryCount = 0;
  const invalidEdgeRegistrySamples: {
    edgeId: string;
    type: DependencyEdgeKind;
    source: string;
    sourceKind: DependencyKind;
    target: string;
    targetKind: DependencyKind;
  }[] = [];

  const addEdge = (edge: GraphEdge, keyOverride?: string): void => {
    if (!validNodeIds.has(edge.source) || !validNodeIds.has(edge.target)) {
      return;
    }

    if (EDGE_REGISTRY_DEBUG && edge.data?.type) {
      const sourceKind = nodeKindsById.get(edge.source);
      const targetKind = nodeKindsById.get(edge.target);
      if (sourceKind && targetKind && !isValidEdgeConnection(edge.data.type, sourceKind, targetKind)) {
        invalidEdgeRegistryCount += 1;
        if (invalidEdgeRegistrySamples.length < EDGE_REGISTRY_DEBUG_SAMPLE_LIMIT) {
          invalidEdgeRegistrySamples.push({
            edgeId: edge.id,
            type: edge.data.type,
            source: edge.source,
            sourceKind,
            target: edge.target,
            targetKind,
          });
        }
      }
    }

    const key =
      keyOverride ??
      `${edge.source}|${edge.target}|${edge.data?.type ?? 'unknown'}|${edge.data?.importName ?? ''}`;

    if (!edgeMap.has(key)) {
      edgeMap.set(key, { ...edge, id: edge.id || key });
    }
  };

  data.packages.forEach((pkg: PackageStructure) => {
    if (resolvedOptions.includePackageEdges) {
      if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
        mapTypeCollection(pkg.dependencies, (dep: DependencyRef) => {
          if (!dep.id) return;
          addEdge(createEdge(pkg.id, dep.id, 'dependency'));
        });
      }

      if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
        mapTypeCollection(pkg.devDependencies, (dep: DependencyRef) => {
          if (!dep.id) return;
          addEdge(createEdge(pkg.id, dep.id, 'devDependency'));
        });
      }

      if (pkg.peerDependencies && Object.keys(pkg.peerDependencies).length > 0) {
        mapTypeCollection(pkg.peerDependencies, (dep: DependencyRef) => {
          if (!dep.id) return;
          addEdge(createEdge(pkg.id, dep.id, 'peerDependency'));
        });
      }
    }

    if (!pkg.modules) {
      return;
    }

    mapTypeCollection(pkg.modules, (module: ModuleStructure) => {
      const moduleId = module.id;
      const packageId = module.package_id;
      const importerPath: string = module.source.relativePath;

      if (module.imports && Object.keys(module.imports).length > 0) {
        mapTypeCollection(module.imports, (imp: ImportRef) => {
          const path = imp.path;
          if (!path) return;
          if (isExternalImportRef(imp)) return;

          const importedModuleId = resolveModuleId(lookup, packageId, importerPath, path);
          if (!importedModuleId || importedModuleId === moduleId) {
            return;
          }

          const source =
            resolvedOptions.importDirection === 'importer-to-imported' ? moduleId : importedModuleId;
          const target =
            resolvedOptions.importDirection === 'importer-to-imported' ? importedModuleId : moduleId;
          const importName: string | undefined = imp.name;
          addEdge(createEdge(source, target, 'import', importName));
        });
      }

      if (module.classes && Object.keys(module.classes).length > 0) {
        mapTypeCollection(module.classes, (cls: ClassStructure) => {
          const clsId = cls.id;
          if (resolvedOptions.includeMemberContainmentEdges) {
            typeCollectionToArray(
              cls.properties as Record<string, NodeProperty> | NodeProperty[]
            ).forEach((property: NodeProperty) => {
              const propertyId = property.id ?? `${clsId}:property:${property.name}`;
              addEdge(createEdge(clsId, propertyId, 'contains'), `${clsId}|${propertyId}|contains|member`);
            });

            typeCollectionToArray(
              cls.methods as Record<string, NodeMethod> | NodeMethod[]
            ).forEach((method: NodeMethod) => {
              const methodId = method.id ?? `${clsId}:method:${method.name}`;
              addEdge(createEdge(clsId, methodId, 'contains'), `${clsId}|${methodId}|contains|member`);
            });
          }

          if (cls.extends_id) {
            const inheritanceEdge = createEdge(clsId, cls.extends_id, 'inheritance');
            classRelationshipEdges.push(inheritanceEdge);
            if (resolvedOptions.includeClassEdges) {
              addEdge(inheritanceEdge);
            }
          }

          if (cls.implemented_interfaces && Object.keys(cls.implemented_interfaces).length > 0) {
            mapTypeCollection(cls.implemented_interfaces, (iface: InterfaceRef) => {
              if (!iface.id) return;
              const implementsEdge = createEdge(clsId, iface.id, 'implements');
              classRelationshipEdges.push(implementsEdge);
              if (resolvedOptions.includeClassEdges) {
                addEdge(implementsEdge);
              }
            });
          }
        });
      }

      if (module.interfaces && Object.keys(module.interfaces).length > 0) {
        mapTypeCollection(module.interfaces, (iface: InterfaceStructure) => {
          const ifaceId = iface.id;
          if (resolvedOptions.includeMemberContainmentEdges) {
            typeCollectionToArray(
              iface.properties as Record<string, NodeProperty> | NodeProperty[]
            ).forEach((property: NodeProperty) => {
              const propertyId = property.id ?? `${ifaceId}:property:${property.name}`;
              addEdge(createEdge(ifaceId, propertyId, 'contains'), `${ifaceId}|${propertyId}|contains|member`);
            });

            typeCollectionToArray(
              iface.methods as Record<string, NodeMethod> | NodeMethod[]
            ).forEach((method: NodeMethod) => {
              const methodId = method.id ?? `${ifaceId}:method:${method.name}`;
              addEdge(createEdge(ifaceId, methodId, 'contains'), `${ifaceId}|${methodId}|contains|member`);
            });
          }

          if (iface.extended_interfaces && Object.keys(iface.extended_interfaces).length > 0) {
            mapTypeCollection(iface.extended_interfaces, (extended: InterfaceRef) => {
              if (!extended.id) return;
              const inheritanceEdge = createEdge(ifaceId, extended.id, 'inheritance');
              classRelationshipEdges.push(inheritanceEdge);
              if (resolvedOptions.includeClassEdges) {
                addEdge(inheritanceEdge);
              }
            });
          }
        });
      }
    });
  });

  if (resolvedOptions.liftClassEdgesToModuleLevel) {
    addLiftedModuleEdges(classRelationshipEdges, symbolToModuleMap, addEdge);
  }

  if (EDGE_REGISTRY_DEBUG && invalidEdgeRegistryCount > 0) {
    console.warn(
      '[createGraphEdges] ' +
        String(invalidEdgeRegistryCount) +
        ' edge(s) failed edge-type registry validation. ' +
        'Set VITE_DEBUG_EDGE_REGISTRY=false (or unset) to silence this check.',
      { sample: invalidEdgeRegistrySamples }
    );
  }

  return Array.from(edgeMap.values());
}
