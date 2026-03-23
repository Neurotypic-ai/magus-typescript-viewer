import { consola } from 'consola';

import { isValidEdgeConnection } from '../graph/edgeTypeRegistry';
import { getEdgeStyle } from '../theme/graphTheme';
import { isNonEmptyCollection, mapTypeCollection, typeCollectionToArray } from './collections';
import { createEdgeMarker } from './edgeMarkers';
import { buildModulePathLookup, isExternalImport, resolveModuleId } from './graphEdgeLookups';

import type { Class } from '../../shared/types/Class';
import type { Import } from '../../shared/types/Import';
import type { Interface } from '../../shared/types/Interface';
import type { Method } from '../../shared/types/Method';
import type { Module } from '../../shared/types/Module';
import type { Package, PackageGraph } from '../../shared/types/Package';
import type { Property } from '../../shared/types/Property';
import type { DependencyEdgeKind } from '../../shared/types/graph/DependencyEdgeKind';
import type { DependencyKind } from '../../shared/types/graph/DependencyKind';
import type { GraphEdge } from '../types/GraphEdge';

type ImportDirection = 'importer-to-imported' | 'imported-to-importer';
const EDGE_REGISTRY_DEBUG =
  import.meta.env.DEV && (import.meta.env['VITE_DEBUG_EDGE_REGISTRY'] as string | undefined) === 'true';
const EDGE_REGISTRY_DEBUG_SAMPLE_LIMIT = 5;
const graphEdgesLogger = consola.withTag('GraphEdges');

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

function buildNodeIdSet(data: PackageGraph, options: ResolvedOptions): Set<string> {
  const nodeIds = new Set<string>();

  data.packages.forEach((pkg: Package) => {
    if (options.includePackageEdges) {
      nodeIds.add(pkg.id);
    }

    if (!pkg.modules) {
      return;
    }

    mapTypeCollection(pkg.modules, (module: Module) => {
      nodeIds.add(module.id);

      if (!options.includeClassEdges) {
        return;
      }

      if (module.classes) {
        mapTypeCollection(module.classes, (cls: Class) => {
          nodeIds.add(cls.id);
          if (options.includeMemberContainmentEdges) {
            typeCollectionToArray(cls.properties as Record<string, Property> | Property[]).forEach(
              (property: Property) => {
                const propertyId = property.id ?? `${cls.id}:property:${property.name}`;
                nodeIds.add(propertyId);
              }
            );
            typeCollectionToArray(cls.methods as Record<string, Method> | Method[]).forEach((method: Method) => {
              const methodId = method.id ?? `${cls.id}:method:${method.name}`;
              nodeIds.add(methodId);
            });
          }
        });
      }

      if (module.interfaces) {
        mapTypeCollection(module.interfaces, (iface: Interface) => {
          nodeIds.add(iface.id);
          if (options.includeMemberContainmentEdges) {
            typeCollectionToArray(iface.properties as Record<string, Property> | Property[]).forEach(
              (property: Property) => {
                const propertyId = property.id ?? `${iface.id}:property:${property.name}`;
                nodeIds.add(propertyId);
              }
            );
            typeCollectionToArray(iface.methods as Record<string, Method> | Method[]).forEach((method: Method) => {
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

function buildNodeKindLookup(data: PackageGraph, options: ResolvedOptions): Map<string, DependencyKind> {
  const nodeKinds = new Map<string, DependencyKind>();

  data.packages.forEach((pkg: Package) => {
    if (options.includePackageEdges) {
      nodeKinds.set(pkg.id, 'package');
    }

    if (!pkg.modules) {
      return;
    }

    mapTypeCollection(pkg.modules, (module: Module) => {
      nodeKinds.set(module.id, 'module');

      if (!options.includeClassEdges) {
        return;
      }

      if (module.classes) {
        mapTypeCollection(module.classes, (cls: Class) => {
          nodeKinds.set(cls.id, 'class');

          if (!options.includeMemberContainmentEdges) {
            return;
          }

          typeCollectionToArray(cls.properties as Record<string, Property> | Property[]).forEach(
            (property: Property) => {
              const propertyId = property.id ?? `${cls.id}:property:${property.name}`;
              nodeKinds.set(propertyId, 'property');
            }
          );

          typeCollectionToArray(cls.methods as Record<string, Method> | Method[]).forEach((method: Method) => {
            const methodId = method.id ?? `${cls.id}:method:${method.name}`;
            nodeKinds.set(methodId, 'method');
          });
        });
      }

      if (module.interfaces) {
        mapTypeCollection(module.interfaces, (iface: Interface) => {
          nodeKinds.set(iface.id, 'interface');

          if (!options.includeMemberContainmentEdges) {
            return;
          }

          typeCollectionToArray(iface.properties as Record<string, Property> | Property[]).forEach(
            (property: Property) => {
              const propertyId = property.id ?? `${iface.id}:property:${property.name}`;
              nodeKinds.set(propertyId, 'property');
            }
          );

          typeCollectionToArray(iface.methods as Record<string, Method> | Method[]).forEach((method: Method) => {
            const methodId = method.id ?? `${iface.id}:method:${method.name}`;
            nodeKinds.set(methodId, 'method');
          });
        });
      }
    });
  });

  return nodeKinds;
}

function buildSymbolToModuleMap(data: PackageGraph): Map<string, string> {
  const symbolToModuleMap = new Map<string, string>();

  data.packages.forEach((pkg: Package) => {
    if (!pkg.modules) {
      return;
    }

    mapTypeCollection(pkg.modules, (module: Module) => {
      const moduleId = module.id;
      if (module.classes) {
        mapTypeCollection(module.classes, (cls: Class) => {
          symbolToModuleMap.set(cls.id, moduleId);
        });
      }

      if (module.interfaces) {
        mapTypeCollection(module.interfaces, (iface: Interface) => {
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

    addEdge(createEdge(sourceModuleId, targetModuleId, type), `${sourceModuleId}|${targetModuleId}|${type}|lifted`);
  });
}

/**
 * Creates graph edges from the provided dependency package graph data.
 */
export function createGraphEdges(data: PackageGraph, options: CreateGraphEdgesOptions = {}): GraphEdge[] {
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
      keyOverride ?? `${edge.source}|${edge.target}|${edge.data?.type ?? 'unknown'}|${edge.data?.importName ?? ''}`;

    if (!edgeMap.has(key)) {
      edgeMap.set(key, { ...edge, id: edge.id || key });
    }
  };

  data.packages.forEach((pkg: Package) => {
    if (resolvedOptions.includePackageEdges) {
      if (isNonEmptyCollection(pkg.dependencies)) {
        mapTypeCollection(pkg.dependencies, (dep: Package) => {
          if (!dep.id) return;
          addEdge(createEdge(pkg.id, dep.id, 'dependency'));
        });
      }

      if (isNonEmptyCollection(pkg.devDependencies)) {
        mapTypeCollection(pkg.devDependencies, (dep: Package) => {
          if (!dep.id) return;
          addEdge(createEdge(pkg.id, dep.id, 'devDependency'));
        });
      }

      if (isNonEmptyCollection(pkg.peerDependencies)) {
        mapTypeCollection(pkg.peerDependencies, (dep: Package) => {
          if (!dep.id) return;
          addEdge(createEdge(pkg.id, dep.id, 'peerDependency'));
        });
      }
    }

    if (!pkg.modules) {
      return;
    }

    mapTypeCollection(pkg.modules, (module: Module) => {
      const moduleId = module.id;
      const packageId = module.package_id;
      const importerPath: string = module.source.relativePath;

      if (isNonEmptyCollection(module.imports)) {
        mapTypeCollection(
          module.imports,
          (imp: Import & { path?: string; isExternal?: boolean; packageName?: string }) => {
            const path = imp.relativePath || imp.fullPath || imp.path || imp.name;
            if (!path) return;
            if (isExternalImport(imp)) return;

            const importedModuleId = resolveModuleId(lookup, packageId, importerPath, path);
            if (!importedModuleId || importedModuleId === moduleId) {
              return;
            }

            const source = resolvedOptions.importDirection === 'importer-to-imported' ? moduleId : importedModuleId;
            const target = resolvedOptions.importDirection === 'importer-to-imported' ? importedModuleId : moduleId;
            const importName: string | undefined = imp.name;
            addEdge(createEdge(source, target, 'import', importName));
          }
        );
      }

      if (isNonEmptyCollection(module.classes)) {
        mapTypeCollection(module.classes, (cls: Class) => {
          const clsId = cls.id;
          if (resolvedOptions.includeMemberContainmentEdges) {
            typeCollectionToArray(cls.properties as Record<string, Property> | Property[]).forEach(
              (property: Property) => {
                const propertyId = property.id ?? `${clsId}:property:${property.name}`;
                addEdge(createEdge(clsId, propertyId, 'contains'), `${clsId}|${propertyId}|contains|member`);
              }
            );

            typeCollectionToArray(cls.methods as Record<string, Method> | Method[]).forEach((method: Method) => {
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

          if (isNonEmptyCollection(cls.implemented_interfaces)) {
            mapTypeCollection(cls.implemented_interfaces, (iface: Interface) => {
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

      if (isNonEmptyCollection(module.interfaces)) {
        mapTypeCollection(module.interfaces, (iface: Interface) => {
          const ifaceId = iface.id;
          if (resolvedOptions.includeMemberContainmentEdges) {
            typeCollectionToArray(iface.properties as Record<string, Property> | Property[]).forEach(
              (property: Property) => {
                const propertyId = property.id ?? `${ifaceId}:property:${property.name}`;
                addEdge(createEdge(ifaceId, propertyId, 'contains'), `${ifaceId}|${propertyId}|contains|member`);
              }
            );

            typeCollectionToArray(iface.methods as Record<string, Method> | Method[]).forEach((method: Method) => {
              const methodId = method.id ?? `${ifaceId}:method:${method.name}`;
              addEdge(createEdge(ifaceId, methodId, 'contains'), `${ifaceId}|${methodId}|contains|member`);
            });
          }

          if (isNonEmptyCollection(iface.extended_interfaces)) {
            mapTypeCollection(iface.extended_interfaces, (extended: Interface) => {
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
    graphEdgesLogger.warn(
      String(invalidEdgeRegistryCount) +
        ' edge(s) failed edge-type registry validation. ' +
        'Set VITE_DEBUG_EDGE_REGISTRY=false (or unset) to silence this check.',
      { sample: invalidEdgeRegistrySamples }
    );
  }

  return Array.from(edgeMap.values());
}
