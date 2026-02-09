import { MarkerType } from '@vue-flow/core';

import { mapTypeCollection } from '../components/DependencyGraph/mapTypeCollection';
import { getEdgeStyle } from '../theme/graphTheme';

import type { DependencyEdgeKind, DependencyPackageGraph, GraphEdge } from '../components/DependencyGraph/types';

/**
 * Normalizes a file path by converting backslashes to forward slashes and removing redundant parts
 * @param path The path to normalize
 * @returns Normalized path
 */
function normalizePath(path: string): string {
  // Convert backslashes to forward slashes
  let normalized = path.replace(/\\/g, '/');

  // Resolve '..' and '.' segments
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

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

function generatePathVariants(normalizedPath: string): string[] {
  const variants = [normalizedPath];
  const withoutExt = normalizedPath.replace(/\.(ts|tsx|js|jsx)$/, '');
  if (withoutExt !== normalizedPath) {
    variants.push(withoutExt);
  }

  const indexMatch = normalizedPath.match(/^(.+)\/index\.(ts|tsx|js|jsx)$/);
  if (indexMatch) {
    const dirPath = indexMatch[1];
    if (dirPath) {
      variants.push(dirPath);
    }
  }

  return Array.from(new Set(variants));
}

/**
 * Gets the directory portion of a file path
 * @param path The file path
 * @returns The directory path
 */
function getDirname(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash > 0 ? normalized.substring(0, lastSlash) : '';
}

/**
 * Joins path segments together
 * @param segments Path segments to join
 * @returns Joined path
 */
function joinPaths(...segments: string[]): string {
  return normalizePath(segments.join('/'));
}

/**
 * Builds a lookup map from module paths to module IDs
 * @param data The dependency package graph data
 * @returns Map of normalized paths to module IDs
 */
function buildModulePathMap(data: DependencyPackageGraph): Map<string, string> {
  const pathMap = new Map<string, string>();

  data.packages.forEach((pkg) => {
    if (pkg.modules) {
      mapTypeCollection(pkg.modules, (module) => {
        // Normalize the path to handle different separators
        const normalizedPath = normalizePath(module.source.relativePath);
        generatePathVariants(normalizedPath).forEach((variant) => {
          pathMap.set(variant, module.id);
        });
      });
    }
  });

  return pathMap;
}

/**
 * Resolves an import path relative to the importing module
 * @param importerPath The path of the module doing the import
 * @param importPath The relative import path
 * @returns Candidate resolved paths
 */
function resolveImportPath(importerPath: string, importPath: string): string[] {
  const importerDir = getDirname(importerPath);
  const baseResolved = joinPaths(importerDir, importPath);
  const candidates: string[] = [baseResolved];

  if (!/\.(ts|tsx|js|jsx)$/.test(importPath)) {
    EXTENSIONS.forEach((ext) => {
      candidates.push(`${baseResolved}${ext}`);
    });
    EXTENSIONS.forEach((ext) => {
      candidates.push(joinPaths(baseResolved, `index${ext}`));
    });
  }

  return candidates;
}

function resolveNonRelativeCandidates(importPath: string, modulePathMap: Map<string, string>): string[] {
  const candidates = [importPath, `src/${importPath}`];
  return candidates.filter((candidate) => modulePathMap.has(normalizePath(candidate)));
}

function findModuleId(modulePathMap: Map<string, string>, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const normalized = normalizePath(candidate);
    const match = modulePathMap.get(normalized);
    if (match) return match;
  }
  return undefined;
}

/**
 * Creates graph edges from the provided dependency package graph data
 * @param data The dependency package graph data
 * @returns Array of edges for the dependency graph
 */
export function createGraphEdges(data: DependencyPackageGraph): GraphEdge[] {
  const edgeMap = new Map<string, GraphEdge>();

  // Build module path lookup for import resolution
  const modulePathMap = buildModulePathMap(data);
  const addEdge = (edge: GraphEdge, keyOverride?: string) => {
    const key =
      keyOverride ??
      `${edge.source}|${edge.target}|${edge.data?.type ?? 'unknown'}|${edge.data?.importName ?? ''}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, { ...edge, id: edge.id || key });
    }
  };

  // Create edges from package dependencies
  data.packages.forEach((pkg) => {
    // Handle regular dependencies
    if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
      mapTypeCollection(pkg.dependencies, (dep) => {
        if (!dep.id) return;

        addEdge({
          id: `${pkg.id}-${dep.id}-dependency`,
          source: pkg.id,
          target: dep.id,
          hidden: false,
          data: {
            type: 'dependency' as DependencyEdgeKind,
          },
          style: getEdgeStyle('dependency'),
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
          },
        });
      });
    }

    // Handle dev dependencies
    if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
      mapTypeCollection(pkg.devDependencies, (dep) => {
        if (!dep.id) return;

        addEdge({
          id: `${pkg.id}-${dep.id}-devDependency`,
          source: pkg.id,
          target: dep.id,
          hidden: false,
          data: {
            type: 'devDependency' as DependencyEdgeKind,
          },
          style: getEdgeStyle('devDependency'),
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
          },
        });
      });
    }

    // Handle peer dependencies
    if (pkg.peerDependencies && Object.keys(pkg.peerDependencies).length > 0) {
      mapTypeCollection(pkg.peerDependencies, (dep) => {
        if (!dep.id) return;

        addEdge({
          id: `${pkg.id}-${dep.id}-peerDependency`,
          source: pkg.id,
          target: dep.id,
          hidden: false,
          data: {
            type: 'peerDependency' as DependencyEdgeKind,
          },
          style: getEdgeStyle('peerDependency'),
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
          },
        });
      });
    }

    // Handle module imports - create edges between modules
    if (pkg.modules && Object.keys(pkg.modules).length > 0) {
      mapTypeCollection(pkg.modules, (module) => {
        // Add module import edges
        if (module.imports && Object.keys(module.imports).length > 0) {
          mapTypeCollection(module.imports, (imp) => {
            if (!imp.path) return; // Skip imports without paths (e.g., external npm packages)

            const isRelative = imp.path.startsWith('.') || imp.path.startsWith('/');
            const candidates = isRelative
              ? resolveImportPath(module.source.relativePath, imp.path)
              : resolveNonRelativeCandidates(imp.path, modulePathMap);
            const targetModuleId = findModuleId(modulePathMap, candidates);

            if (targetModuleId && targetModuleId !== module.id) {
              // Arrow points FROM imported module TO importing module
              // Shows "is imported by" / "is used by" relationship
              // If module A imports module B, arrow goes: B -> A
              addEdge({
                id: `${targetModuleId}-${module.id}-import`,
                source: targetModuleId,
                target: module.id,
                hidden: false,
                data: {
                  type: 'import' as DependencyEdgeKind,
                  importName: imp.name,
                },
                style: getEdgeStyle('import'),
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  width: 20,
                  height: 20,
                },
              });
            }
          });
        }

        // Add class inheritance and implementation edges
        if (module.classes && Object.keys(module.classes).length > 0) {
          mapTypeCollection(module.classes, (cls) => {
            // Handle class inheritance
            if (cls.extends_id) {
              addEdge({
                id: `${cls.id}-${cls.extends_id}-inheritance`,
                source: cls.id,
                target: cls.extends_id,
                hidden: false,
                data: {
                  type: 'inheritance' as DependencyEdgeKind,
                },
                style: getEdgeStyle('inheritance'),
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  width: 20,
                  height: 20,
                },
              });
            }

            // Handle interface implementations
            if (cls.implemented_interfaces && Object.keys(cls.implemented_interfaces).length > 0) {
              mapTypeCollection(cls.implemented_interfaces, (iface) => {
                if (!iface.id) return;

                addEdge({
                  id: `${cls.id}-${iface.id}-implements`,
                  source: cls.id,
                  target: iface.id,
                  hidden: false,
                  data: {
                    type: 'implements' as DependencyEdgeKind,
                  },
                  style: getEdgeStyle('implements'),
                  markerEnd: {
                    type: MarkerType.ArrowClosed,
                    width: 20,
                    height: 20,
                  },
                });
              });
            }
          });
        }

        // Add interface inheritance edges
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
                  data: {
                    type: 'inheritance' as DependencyEdgeKind,
                  },
                  style: getEdgeStyle('inheritance'),
                  markerEnd: {
                    type: MarkerType.ArrowClosed,
                    width: 20,
                    height: 20,
                  },
                });
              });
            }
          });
        }
      });
    }
  });

  return Array.from(edgeMap.values());
}
