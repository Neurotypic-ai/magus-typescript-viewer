import { consola } from 'consola';

import { isValidEdgeConnection } from '../graph/edgeTypeRegistry';
import { getEdgeStyle } from '../theme/graphTheme';
import { isNonEmptyCollection, mapTypeCollection, typeCollectionToArray } from './collections';
import { createEdgeMarker } from './edgeMarkers';
import { buildModulePathLookup, isExternalImport, resolveModuleId } from './graphEdgeLookups';

import type { IClass } from '../../shared/types/Class';
import type { IExport } from '../../shared/types/Export';
import type { Import } from '../../shared/types/Import';
import type { IInterface } from '../../shared/types/Interface';
import type { Method } from '../../shared/types/Method';
import type { IModule } from '../../shared/types/Module';
import type { IPackage, PackageGraph } from '../../shared/types/Package';
import type { Property } from '../../shared/types/Property';
import type { ISymbolReference } from '../../shared/types/SymbolReference';
import type { DependencyEdgeKind } from '../../shared/types/graph/DependencyEdgeKind';
import type { DependencyKind } from '../../shared/types/graph/DependencyKind';
import type { GraphEdge } from '../types/GraphEdge';

type ImportDirection = 'importer-to-imported' | 'imported-to-importer';
const EDGE_REGISTRY_DEBUG =
  import.meta.env.DEV && (import.meta.env['VITE_DEBUG_EDGE_REGISTRY'] as string | undefined) === 'true';
const EDGE_REGISTRY_DEBUG_SAMPLE_LIMIT = 5;
const graphEdgesLogger = consola.withTag('GraphEdges');

interface CreateGraphEdgesOptions {
  includePackageEdges?: boolean;
  includeClassEdges?: boolean;
  // Backward-compatible alias for includeClassEdges
  includeSymbolEdges?: boolean;
  includeMemberContainmentEdges?: boolean;
  liftClassEdgesToModuleLevel?: boolean;
  importDirection?: ImportDirection;
  includeUsesEdges?: boolean;
  includeExternalPackageEdges?: boolean;
}

interface ResolvedOptions {
  includePackageEdges: boolean;
  includeClassEdges: boolean;
  includeMemberContainmentEdges: boolean;
  liftClassEdgesToModuleLevel: boolean;
  importDirection: ImportDirection;
  includeUsesEdges: boolean;
  includeExternalPackageEdges: boolean;
}

interface NodeIndex {
  nodeIds: Set<string>;
  nodeKinds: Map<string, DependencyKind>;
  symbolToModule: Map<string, string>;
}

type ExternalPackageKind = 'dependency' | 'devDependency' | 'peerDependency' | 'import';

/**
 * Build a lookup from package id to a map of external-package-name → dep classification.
 *
 * Reads from `pkg.externalDepsByName` — a plain `{name: scope}` object populated from
 * the package.json scope metadata stored on the `packages` row in the DB. The older
 * `pkg.dependencies` / `pkg.devDependencies` / `pkg.peerDependencies` Maps are not used
 * here because they only contain workspace-internal packages (external npm packages
 * aren't rows in the `packages` table, so the junction table stays empty for them).
 *
 * Scope precedence when a name appears in multiple lists is resolved on the server
 * side (see buildExternalDepsByName in PackageRepository.ts) as:
 *   dependency > peerDependency > devDependency (matches package-manager resolution).
 */
function buildExternalPackageKindLookup(
  data: PackageGraph
): Map<string, Map<string, ExternalPackageKind>> {
  const lookup = new Map<string, Map<string, ExternalPackageKind>>();
  for (const pkg of data.packages) {
    const nameToKind = new Map<string, ExternalPackageKind>();
    const externalDepsByName = (pkg as { externalDepsByName?: Record<string, ExternalPackageKind> })
      .externalDepsByName;
    if (externalDepsByName) {
      for (const [name, scope] of Object.entries(externalDepsByName)) {
        if (scope === 'dependency' || scope === 'devDependency' || scope === 'peerDependency') {
          nameToKind.set(name, scope);
        }
      }
    }
    lookup.set(pkg.id, nameToKind);
  }
  return lookup;
}

function registerMembers(entity: IClass | IInterface, index: NodeIndex): void {
  typeCollectionToArray(entity.properties as Record<string, Property> | Property[]).forEach(
    (property: Property) => {
      index.nodeIds.add(property.id);
      index.nodeKinds.set(property.id, 'property');
    }
  );
  typeCollectionToArray(entity.methods as Record<string, Method> | Method[]).forEach((method: Method) => {
    index.nodeIds.add(method.id);
    index.nodeKinds.set(method.id, 'method');
  });
}

function buildNodeIndex(data: PackageGraph, options: ResolvedOptions): NodeIndex {
  const index: NodeIndex = {
    nodeIds: new Set<string>(),
    nodeKinds: new Map<string, DependencyKind>(),
    symbolToModule: new Map<string, string>(),
  };

  data.packages.forEach((pkg: IPackage) => {
    if (options.includePackageEdges) {
      index.nodeIds.add(pkg.id);
      index.nodeKinds.set(pkg.id, 'package');
    }

    if (!isNonEmptyCollection(pkg.modules)) return;

    mapTypeCollection(pkg.modules, (module: IModule) => {
      index.nodeIds.add(module.id);
      index.nodeKinds.set(module.id, 'module');

      if (isNonEmptyCollection(module.classes)) {
        mapTypeCollection(module.classes, (cls: IClass) => {
          index.symbolToModule.set(cls.id, module.id);
          if (options.includeUsesEdges) {
            typeCollectionToArray(cls.properties as Record<string, Property> | Property[]).forEach(
              (p: Property) => { index.symbolToModule.set(p.id, module.id); }
            );
            typeCollectionToArray(cls.methods as Record<string, Method> | Method[]).forEach(
              (m: Method) => { index.symbolToModule.set(m.id, module.id); }
            );
          }
          if (!options.includeClassEdges) return;
          index.nodeIds.add(cls.id);
          index.nodeKinds.set(cls.id, 'class');
          if (options.includeMemberContainmentEdges) {
            registerMembers(cls, index);
          }
        });
      }

      if (isNonEmptyCollection(module.interfaces)) {
        mapTypeCollection(module.interfaces, (iface: IInterface) => {
          index.symbolToModule.set(iface.id, module.id);
          if (options.includeUsesEdges) {
            typeCollectionToArray(iface.properties as Record<string, Property> | Property[]).forEach(
              (p: Property) => { index.symbolToModule.set(p.id, module.id); }
            );
            typeCollectionToArray(iface.methods as Record<string, Method> | Method[]).forEach(
              (m: Method) => { index.symbolToModule.set(m.id, module.id); }
            );
          }
          if (!options.includeClassEdges) return;
          index.nodeIds.add(iface.id);
          index.nodeKinds.set(iface.id, 'interface');
          if (options.includeMemberContainmentEdges) {
            registerMembers(iface, index);
          }
        });
      }
    });
  });

  if (options.includeExternalPackageEdges) {
    data.packages.forEach((pkg: IPackage) => {
      if (!isNonEmptyCollection(pkg.modules)) return;
      mapTypeCollection(pkg.modules, (module: IModule) => {
        if (!isNonEmptyCollection(module.imports)) return;
        mapTypeCollection(
          module.imports,
          (imp: Import & { path?: string; isExternal?: boolean; packageName?: string }) => {
            if (!isExternalImport(imp)) return;
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional: skip empty strings
            const path = imp.relativePath || imp.fullPath || imp.path || imp.name || '';
            const segments = path.split('/');
            const pkgName =
              imp.packageName ?? (path.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? ''));
            if (!pkgName) return;
            const externalId = `external:${pkgName}`;
            index.nodeIds.add(externalId);
            index.nodeKinds.set(externalId, 'externalPackage');
          }
        );
      });
    });
  }

  return index;
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

function addContainmentEdges(
  parentId: string,
  entity: IClass | IInterface,
  addEdge: (edge: GraphEdge, keyOverride?: string) => void
): void {
  typeCollectionToArray(entity.properties as Record<string, Property> | Property[]).forEach(
    (property: Property) => {
      addEdge(createEdge(parentId, property.id, 'contains'), `${parentId}|${property.id}|contains|member`);
    }
  );
  typeCollectionToArray(entity.methods as Record<string, Method> | Method[]).forEach((method: Method) => {
    addEdge(createEdge(parentId, method.id, 'contains'), `${parentId}|${method.id}|contains|member`);
  });
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
    includeUsesEdges: options.includeUsesEdges ?? false,
    includeExternalPackageEdges: options.includeExternalPackageEdges ?? false,
  };

  const lookup = buildModulePathLookup(data);
  const externalPackageKindByPackageId = buildExternalPackageKindLookup(data);
  const { nodeIds: validNodeIds, nodeKinds: nodeKindsById, symbolToModule: symbolToModuleMap } =
    buildNodeIndex(data, resolvedOptions);
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
      edgeMap.set(key, { ...edge, id: key });
    }
  };

  data.packages.forEach((pkg: IPackage) => {
    if (resolvedOptions.includePackageEdges) {
      if (isNonEmptyCollection(pkg.dependencies)) {
        mapTypeCollection(pkg.dependencies, (dep: IPackage) => {
          if (!dep.id) return;
          addEdge(createEdge(pkg.id, dep.id, 'dependency'));
        });
      }

      if (isNonEmptyCollection(pkg.devDependencies)) {
        mapTypeCollection(pkg.devDependencies, (dep: IPackage) => {
          if (!dep.id) return;
          addEdge(createEdge(pkg.id, dep.id, 'devDependency'));
        });
      }

      if (isNonEmptyCollection(pkg.peerDependencies)) {
        mapTypeCollection(pkg.peerDependencies, (dep: IPackage) => {
          if (!dep.id) return;
          addEdge(createEdge(pkg.id, dep.id, 'peerDependency'));
        });
      }
    }

    if (!isNonEmptyCollection(pkg.modules)) return;

    mapTypeCollection(pkg.modules, (module: IModule) => {
      const moduleId = module.id;
      const packageId = module.package_id;
      const importerPath: string = module.source.relativePath;

      if (isNonEmptyCollection(module.imports)) {
        mapTypeCollection(
          module.imports,
          (imp: Import & { path?: string; isExternal?: boolean; packageName?: string }) => {
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional: skip empty strings
            const path = imp.relativePath || imp.fullPath || imp.path || imp.name;
            if (!path) return;

            if (isExternalImport(imp)) {
              if (resolvedOptions.includeExternalPackageEdges) {
                const segments = path.split('/');
                const pkgName =
                  imp.packageName ?? (path.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? ''));
                if (pkgName) {
                  const externalKind =
                    externalPackageKindByPackageId.get(packageId)?.get(pkgName) ?? 'import';
                  addEdge(
                    createEdge(moduleId, `external:${pkgName}`, externalKind),
                    `${moduleId}|external:${pkgName}|${externalKind}`
                  );
                }
              }
              return;
            }

            const importedModuleId = resolveModuleId(lookup, packageId, importerPath, path);
            if (!importedModuleId || importedModuleId === moduleId) return;

            const source = resolvedOptions.importDirection === 'importer-to-imported' ? moduleId : importedModuleId;
            const target = resolvedOptions.importDirection === 'importer-to-imported' ? importedModuleId : moduleId;
            addEdge(createEdge(source, target, 'import', imp.name));
          }
        );
      }

      if (isNonEmptyCollection(module.exports)) {
        mapTypeCollection(module.exports, (exp: IExport) => {
          if (!exp.exportedFrom) return;
          addEdge(createEdge(moduleId, exp.exportedFrom, 'export', exp.name));
        });
      }

      if (isNonEmptyCollection(module.classes)) {
        mapTypeCollection(module.classes, (cls: IClass) => {
          if (resolvedOptions.includeMemberContainmentEdges) {
            addContainmentEdges(cls.id, cls, addEdge);
          }

          if (cls.extends_id) {
            const classExtendsEdge = createEdge(cls.id, cls.extends_id, 'extends');
            classRelationshipEdges.push(classExtendsEdge);
            if (resolvedOptions.includeClassEdges) {
              addEdge(classExtendsEdge);
            }
          }

          if (isNonEmptyCollection(cls.implemented_interfaces)) {
            mapTypeCollection(cls.implemented_interfaces, (iface: IInterface) => {
              if (!iface.id) return;
              const implementsEdge = createEdge(cls.id, iface.id, 'implements');
              classRelationshipEdges.push(implementsEdge);
              if (resolvedOptions.includeClassEdges) {
                addEdge(implementsEdge);
              }
            });
          }
        });
      }

      if (isNonEmptyCollection(module.interfaces)) {
        mapTypeCollection(module.interfaces, (iface: IInterface) => {
          if (resolvedOptions.includeMemberContainmentEdges) {
            addContainmentEdges(iface.id, iface, addEdge);
          }

          if (isNonEmptyCollection(iface.extended_interfaces)) {
            mapTypeCollection(iface.extended_interfaces, (extended: IInterface) => {
              if (!extended.id) return;
              const extendsEdge = createEdge(iface.id, extended.id, 'extends');
              classRelationshipEdges.push(extendsEdge);
              if (resolvedOptions.includeClassEdges) {
                addEdge(extendsEdge);
              }
            });
          }
        });
      }

      if (resolvedOptions.includeUsesEdges && isNonEmptyCollection(module.symbol_references)) {
        mapTypeCollection(module.symbol_references, (ref: ISymbolReference) => {
          if (!ref.source_symbol_id) return;
          if (resolvedOptions.includeClassEdges) {
            addEdge(createEdge(ref.source_symbol_id, ref.target_symbol_id, 'uses'));
          } else if (resolvedOptions.liftClassEdgesToModuleLevel) {
            const targetModuleId = symbolToModuleMap.get(ref.target_symbol_id);
            if (!targetModuleId || targetModuleId === moduleId) return;
            addEdge(
              createEdge(moduleId, targetModuleId, 'uses'),
              `${moduleId}|${targetModuleId}|uses|lifted`
            );
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
