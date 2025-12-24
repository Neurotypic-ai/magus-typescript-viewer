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
        pathMap.set(normalizedPath, module.id);

        // Also add without extension for matching flexibility
        const withoutExt = normalizedPath.replace(/\.(ts|tsx|js|jsx)$/, '');
        pathMap.set(withoutExt, module.id);
      });
    }
  });

  return pathMap;
}

/**
 * Resolves an import path relative to the importing module
 * @param importerPath The path of the module doing the import
 * @param importPath The relative import path
 * @returns The resolved absolute path
 */
function resolveImportPath(importerPath: string, importPath: string): string {
  const importerDir = getDirname(importerPath);
  return joinPaths(importerDir, importPath);
}

/**
 * Creates graph edges from the provided dependency package graph data
 * @param data The dependency package graph data
 * @returns Array of edges for the dependency graph
 */
export function createGraphEdges(data: DependencyPackageGraph): GraphEdge[] {
  const edges: GraphEdge[] = [];

  // Build module path lookup for import resolution
  const modulePathMap = buildModulePathMap(data);

  // Create edges from package dependencies
  data.packages.forEach((pkg) => {
    // Handle regular dependencies
    if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
      mapTypeCollection(pkg.dependencies, (dep) => {
        if (!dep.id) return;

        edges.push({
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

        edges.push({
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

        edges.push({
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

            // Resolve the import path relative to the current module
            const resolvedPath = resolveImportPath(module.source.relativePath, imp.path);

            // Look up the target module ID
            const targetModuleId =
              modulePathMap.get(resolvedPath) ?? modulePathMap.get(resolvedPath.replace(/\.(ts|tsx|js|jsx)$/, ''));

            if (targetModuleId && targetModuleId !== module.id) {
              // Arrow points FROM imported module TO importing module
              // Shows "is imported by" / "is used by" relationship
              // If module A imports module B, arrow goes: B -> A
              edges.push({
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
              edges.push({
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

                edges.push({
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

                edges.push({
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

  return edges;
}
