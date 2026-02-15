import { createEdgeMarker } from './edgeMarkers';
import { isValidEdgeConnection } from '../graph/edgeTypeRegistry';
import { mapTypeCollection, typeCollectionToArray } from './collections';
import { getEdgeStyle } from '../theme/graphTheme';

import type {
  ClassStructure,
  DependencyEdgeKind,
  DependencyKind,
  DependencyPackageGraph,
  DependencyRef,
  GraphEdge,
  ImportRef,
  InterfaceRef,
  InterfaceStructure,
  ModuleStructure,
  NodeMethod,
  NodeProperty,
  PackageStructure,
} from '../types';

type ImportDirection = 'importer-to-imported' | 'imported-to-importer';

export interface CreateGraphEdgesOptions {
  includePackageEdges?: boolean;
  includeClassEdges?: boolean;
  // Backward-compatible alias for includeClassEdges
  includeSymbolEdges?: boolean;
  includeMemberContainmentEdges?: boolean;
  liftClassEdgesToModuleLevel?: boolean;
  importDirection?: ImportDirection;
}

interface ModulePathLookup {
  packagePathMap: Map<string, Map<string, string>>;
  globalPathMap: Map<string, Set<string>>;
}

interface ResolvedOptions {
  includePackageEdges: boolean;
  includeClassEdges: boolean;
  includeMemberContainmentEdges: boolean;
  liftClassEdgesToModuleLevel: boolean;
  importDirection: ImportDirection;
}


function isExternalImportRef(imp: { isExternal?: boolean; packageName?: string; path?: string | undefined }): boolean {
  if (imp.isExternal === true) {
    return true;
  }

  if (typeof imp.packageName === 'string' && imp.packageName.length > 0) {
    return true;
  }

  const path = imp.path;
  if (!path) {
    return false;
  }

  // Treat bare package imports as metadata-only, not graph topology edges.
  if (!path.startsWith('.') && !path.startsWith('/') && !path.startsWith('@/') && !path.startsWith('src/')) {
    return true;
  }

  return false;
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'] as const;
const FILE_EXTENSION_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|vue)$/i;
const INDEX_FILE_PATTERN = /^(.*)\/index\.(ts|tsx|js|jsx|mjs|cjs|vue)$/i;

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const result: string[] = [];

  for (const part of parts) {
    if (part === '..') {
      result.pop();
    } else if (part !== '.' && part !== '') {
      result.push(part);
    }
  }

  return result.join('/');
}

function getDirname(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash > 0 ? normalized.substring(0, lastSlash) : '';
}

function joinPaths(...segments: string[]): string {
  return normalizePath(segments.join('/'));
}

function generatePathVariants(normalizedPath: string): string[] {
  const variants = [normalizedPath];
  const withoutExt = normalizedPath.replace(FILE_EXTENSION_PATTERN, '');

  if (withoutExt !== normalizedPath) {
    variants.push(withoutExt);
  }

  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec
  const indexMatch = normalizedPath.match(INDEX_FILE_PATTERN);
  if (indexMatch?.[1]) {
    variants.push(indexMatch[1]);
  }

  return Array.from(new Set(variants));
}

function addModulePathEntry(pathMap: Map<string, string>, relativePath: string, moduleId: string): void {
  const normalizedPath = normalizePath(relativePath);
  for (const variant of generatePathVariants(normalizedPath)) {
    pathMap.set(variant, moduleId);
  }
}

function buildModulePathLookup(data: DependencyPackageGraph): ModulePathLookup {
  const packagePathMap = new Map<string, Map<string, string>>();
  const globalPathMap = new Map<string, Set<string>>();

  data.packages.forEach((pkg: PackageStructure) => {
    const pathMap = new Map<string, string>();
    packagePathMap.set(pkg.id, pathMap);

    if (!pkg.modules) {
      return;
    }

    mapTypeCollection(pkg.modules, (module: ModuleStructure) => {
      const relativePath: string = module.source.relativePath;
      const moduleId: string = module.id;
      addModulePathEntry(pathMap, relativePath, moduleId);
      for (const variant of generatePathVariants(normalizePath(relativePath))) {
        const existing = globalPathMap.get(variant);
        if (existing) {
          existing.add(moduleId);
        } else {
          globalPathMap.set(variant, new Set<string>([moduleId]));
        }
      }
    });
  });

  return { packagePathMap, globalPathMap };
}

function getPackagePrefixFromImporter(importerPath: string): string | undefined {
  const normalized = normalizePath(importerPath);
  const marker = '/src/';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex <= 0) {
    return undefined;
  }
  return normalized.slice(0, markerIndex);
}

function expandCandidatePath(path: string): string[] {
  const normalized = normalizePath(path);
  const candidates = new Set<string>([normalized]);
  const hasExplicitExtension = FILE_EXTENSION_PATTERN.test(normalized);

  if (!hasExplicitExtension) {
    for (const extension of EXTENSIONS) {
      candidates.add(`${normalized}${extension}`);
      candidates.add(joinPaths(normalized, `index${extension}`));
    }
  }

  return Array.from(candidates);
}

function resolveRelativeCandidates(importerPath: string, importPath: string): string[] {
  const importerDir = getDirname(importerPath);
  const resolvedBasePath = joinPaths(importerDir, importPath);
  return expandCandidatePath(resolvedBasePath);
}

function resolveNonRelativeCandidates(importerPath: string, importPath: string): string[] {
  const normalizedImportPath = normalizePath(importPath);
  const baseCandidates = new Set<string>();
  const packagePrefix = getPackagePrefixFromImporter(importerPath);

  if (normalizedImportPath.startsWith('@/')) {
    const suffix = normalizedImportPath.slice(2);
    baseCandidates.add(`src/${suffix}`);
    if (packagePrefix) {
      baseCandidates.add(`${packagePrefix}/src/${suffix}`);
    }
  } else if (normalizedImportPath.startsWith('src/')) {
    baseCandidates.add(normalizedImportPath);
    if (packagePrefix) {
      baseCandidates.add(`${packagePrefix}/${normalizedImportPath}`);
    }
  } else {
    return [];
  }

  const expandedCandidates = new Set<string>();
  for (const candidate of baseCandidates) {
    for (const expanded of expandCandidatePath(candidate)) {
      expandedCandidates.add(expanded);
    }
  }

  return Array.from(expandedCandidates);
}

function resolveModuleId(
  lookup: ModulePathLookup,
  packageId: string,
  importerPath: string,
  importPath: string
): string | undefined {
  const isRelative = importPath.startsWith('.') || importPath.startsWith('/');
  const candidates = isRelative
    ? resolveRelativeCandidates(importerPath, importPath)
    : resolveNonRelativeCandidates(importerPath, importPath);

  const packageLookup = lookup.packagePathMap.get(packageId);

  for (const candidate of candidates) {
    const normalized = normalizePath(candidate);
    const packageMatch = packageLookup?.get(normalized);
    if (packageMatch) {
      return packageMatch;
    }

    const globalMatches = lookup.globalPathMap.get(normalized);
    if (globalMatches?.size === 1) {
      const [globalMatch] = Array.from(globalMatches);
      return globalMatch;
    }
  }

  return undefined;
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

  const addEdge = (edge: GraphEdge, keyOverride?: string): void => {
    if (!validNodeIds.has(edge.source) || !validNodeIds.has(edge.target)) {
      return;
    }

    if (import.meta.env.DEV && edge.data?.type) {
      const sourceKind = nodeKindsById.get(edge.source);
      const targetKind = nodeKindsById.get(edge.target);
      if (sourceKind && targetKind && !isValidEdgeConnection(edge.data.type, sourceKind, targetKind)) {
        console.warn(
          '[createGraphEdges] Edge kind and endpoint kinds do not match registry',
          {
            edgeId: edge.id,
            type: edge.data.type,
            source: edge.source,
            sourceKind,
            target: edge.target,
            targetKind,
          }
        );
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

  return Array.from(edgeMap.values());
}
