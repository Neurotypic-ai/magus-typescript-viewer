import { MarkerType } from '@vue-flow/core';

import { mapTypeCollection } from '../components/DependencyGraph/mapTypeCollection';
import { getEdgeStyle } from '../theme/graphTheme';

import type { DependencyEdgeKind, DependencyPackageGraph, GraphEdge } from '../components/DependencyGraph/types';

type ImportDirection = 'importer-to-imported' | 'imported-to-importer';

export interface CreateGraphEdgesOptions {
  includePackageEdges?: boolean;
  includeSymbolEdges?: boolean;
  importDirection?: ImportDirection;
}

interface ModulePathLookup {
  packagePathMap: Map<string, Map<string, string>>;
  globalPathMap: Map<string, Set<string>>;
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

  const indexMatch = INDEX_FILE_PATTERN.exec(normalizedPath);
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

  data.packages.forEach((pkg) => {
    const pathMap = new Map<string, string>();
    packagePathMap.set(pkg.id, pathMap);

    if (!pkg.modules) {
      return;
    }

    mapTypeCollection(pkg.modules, (module) => {
      addModulePathEntry(pathMap, module.source.relativePath, module.id);
      for (const variant of generatePathVariants(normalizePath(module.source.relativePath))) {
        const existing = globalPathMap.get(variant);
        if (existing) {
          existing.add(module.id);
        } else {
          globalPathMap.set(variant, new Set([module.id]));
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

function buildNodeIdSet(data: DependencyPackageGraph, options: Required<CreateGraphEdgesOptions>): Set<string> {
  const nodeIds = new Set<string>();

  data.packages.forEach((pkg) => {
    if (options.includePackageEdges) {
      nodeIds.add(pkg.id);
    }

    if (!pkg.modules) {
      return;
    }

    mapTypeCollection(pkg.modules, (module) => {
      nodeIds.add(module.id);

      if (!options.includeSymbolEdges) {
        return;
      }

      if (module.classes) {
        mapTypeCollection(module.classes, (cls) => {
          nodeIds.add(cls.id);
        });
      }

      if (module.interfaces) {
        mapTypeCollection(module.interfaces, (iface) => {
          nodeIds.add(iface.id);
        });
      }
    });
  });

  return nodeIds;
}

function createArrowMarker() {
  return {
    type: MarkerType.ArrowClosed,
    width: 20,
    height: 20,
  };
}

/**
 * Creates graph edges from the provided dependency package graph data.
 */
export function createGraphEdges(
  data: DependencyPackageGraph,
  options: CreateGraphEdgesOptions = {}
): GraphEdge[] {
  const resolvedOptions: Required<CreateGraphEdgesOptions> = {
    includePackageEdges: options.includePackageEdges ?? false,
    includeSymbolEdges: options.includeSymbolEdges ?? true,
    importDirection: options.importDirection ?? 'importer-to-imported',
  };

  const lookup = buildModulePathLookup(data);
  const validNodeIds = buildNodeIdSet(data, resolvedOptions);
  const edgeMap = new Map<string, GraphEdge>();

  const addEdge = (edge: GraphEdge, keyOverride?: string): void => {
    if (!validNodeIds.has(edge.source) || !validNodeIds.has(edge.target)) {
      return;
    }

    const key =
      keyOverride ??
      `${edge.source}|${edge.target}|${edge.data?.type ?? 'unknown'}|${edge.data?.importName ?? ''}`;

    if (!edgeMap.has(key)) {
      edgeMap.set(key, { ...edge, id: edge.id || key });
    }
  };

  data.packages.forEach((pkg) => {
    if (resolvedOptions.includePackageEdges) {
      if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
        mapTypeCollection(pkg.dependencies, (dep) => {
          if (!dep.id) return;

          addEdge({
            id: `${pkg.id}-${dep.id}-dependency`,
            source: pkg.id,
            target: dep.id,
            hidden: false,
            data: { type: 'dependency' as DependencyEdgeKind },
            style: getEdgeStyle('dependency'),
            markerEnd: createArrowMarker(),
          });
        });
      }

      if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
        mapTypeCollection(pkg.devDependencies, (dep) => {
          if (!dep.id) return;

          addEdge({
            id: `${pkg.id}-${dep.id}-devDependency`,
            source: pkg.id,
            target: dep.id,
            hidden: false,
            data: { type: 'devDependency' as DependencyEdgeKind },
            style: getEdgeStyle('devDependency'),
            markerEnd: createArrowMarker(),
          });
        });
      }

      if (pkg.peerDependencies && Object.keys(pkg.peerDependencies).length > 0) {
        mapTypeCollection(pkg.peerDependencies, (dep) => {
          if (!dep.id) return;

          addEdge({
            id: `${pkg.id}-${dep.id}-peerDependency`,
            source: pkg.id,
            target: dep.id,
            hidden: false,
            data: { type: 'peerDependency' as DependencyEdgeKind },
            style: getEdgeStyle('peerDependency'),
            markerEnd: createArrowMarker(),
          });
        });
      }
    }

    if (!pkg.modules) {
      return;
    }

    mapTypeCollection(pkg.modules, (module) => {
      if (module.imports && Object.keys(module.imports).length > 0) {
        mapTypeCollection(module.imports, (imp) => {
          if (!imp.path) return;

          const importedModuleId = resolveModuleId(lookup, module.package_id, module.source.relativePath, imp.path);
          if (!importedModuleId || importedModuleId === module.id) {
            return;
          }

          const source =
            resolvedOptions.importDirection === 'importer-to-imported' ? module.id : importedModuleId;
          const target =
            resolvedOptions.importDirection === 'importer-to-imported' ? importedModuleId : module.id;

          addEdge({
            id: `${source}-${target}-import`,
            source,
            target,
            hidden: false,
            data: {
              type: 'import' as DependencyEdgeKind,
              importName: imp.name,
            },
            style: getEdgeStyle('import'),
            markerEnd: createArrowMarker(),
          });
        });
      }

      if (!resolvedOptions.includeSymbolEdges) {
        return;
      }

      if (module.classes && Object.keys(module.classes).length > 0) {
        mapTypeCollection(module.classes, (cls) => {
          if (cls.extends_id) {
            addEdge({
              id: `${cls.id}-${cls.extends_id}-inheritance`,
              source: cls.id,
              target: cls.extends_id,
              hidden: false,
              data: { type: 'inheritance' as DependencyEdgeKind },
              style: getEdgeStyle('inheritance'),
              markerEnd: createArrowMarker(),
            });
          }

          if (cls.implemented_interfaces && Object.keys(cls.implemented_interfaces).length > 0) {
            mapTypeCollection(cls.implemented_interfaces, (iface) => {
              if (!iface.id) return;

              addEdge({
                id: `${cls.id}-${iface.id}-implements`,
                source: cls.id,
                target: iface.id,
                hidden: false,
                data: { type: 'implements' as DependencyEdgeKind },
                style: getEdgeStyle('implements'),
                markerEnd: createArrowMarker(),
              });
            });
          }
        });
      }

      if (module.interfaces && Object.keys(module.interfaces).length > 0) {
        mapTypeCollection(module.interfaces, (iface) => {
          if (iface.extended_interfaces && Object.keys(iface.extended_interfaces).length > 0) {
            mapTypeCollection(iface.extended_interfaces, (extended) => {
              if (!extended.id) return;

              addEdge({
                id: `${iface.id}-${extended.id}-inheritance`,
                source: iface.id,
                target: extended.id,
                hidden: false,
                data: { type: 'inheritance' as DependencyEdgeKind },
                style: getEdgeStyle('inheritance'),
                markerEnd: createArrowMarker(),
              });
            });
          }
        });
      }
    });
  });

  return Array.from(edgeMap.values());
}
