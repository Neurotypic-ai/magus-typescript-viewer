import * as path from 'path';

import { toUndirected } from './graph-algorithms';

import type { DatabaseRow, IDatabaseAdapter } from '../db/adapter/IDatabaseAdapter';

interface ModuleRow extends DatabaseRow {
  package_id: string;
  name: string;
  directory: string;
  relative_path: string;
  is_barrel: boolean | string;
  line_count: number | string;
}

interface ImportRow extends DatabaseRow {
  module_id: string;
  source: string;
  is_type_only: boolean | string;
}

export interface ModuleMeta {
  name: string;
  directory: string;
  relativePath: string;
  isBarrel: boolean;
  lineCount: number;
  packageId: string;
}

export interface ImportGraph {
  /** module_id -> set of module_ids it imports */
  adjacency: Map<string, Set<string>>;
  /** module_id -> set of module_ids that import it */
  reverseAdjacency: Map<string, Set<string>>;
  /** undirected version of the adjacency graph */
  undirected: Map<string, Set<string>>;
  /** module_id -> metadata */
  modules: Map<string, ModuleMeta>;
  /** all module IDs */
  nodeIds: Set<string>;
}

function normalizePath(p: string): string {
  const withoutExt = p.replace(/\.(tsx?|jsx?|mjs|cjs|vue)$/, '');
  return withoutExt.replace(/\/index$/, '');
}

function isIndexModulePath(relativePath: string): boolean {
  return /\/index\.(tsx?|jsx?|mjs|cjs|vue)$/i.test(relativePath);
}

function shouldPreferCandidate(existingPath: string, candidatePath: string): boolean {
  const existingIsIndex = isIndexModulePath(existingPath);
  const candidateIsIndex = isIndexModulePath(candidatePath);

  if (existingIsIndex !== candidateIsIndex) {
    return existingIsIndex && !candidateIsIndex;
  }

  return candidatePath.length < existingPath.length;
}

function isInternalImport(source: string): boolean {
  return source.startsWith('.') || source.startsWith('/') || source.startsWith('@/') || source.startsWith('src/');
}

function toBool(v: boolean | string): boolean {
  return v === true || v === 'true' || v === '1';
}

export async function buildImportGraph(adapter: IDatabaseAdapter, packageId?: string): Promise<ImportGraph> {
  const moduleQuery = packageId
    ? 'SELECT id, package_id, name, directory, relative_path, is_barrel, line_count FROM modules WHERE package_id = ?'
    : 'SELECT id, package_id, name, directory, relative_path, is_barrel, line_count FROM modules';
  const moduleRows = await adapter.query<ModuleRow>(moduleQuery, packageId ? [packageId] : []);

  // Build normalized-path -> module_id lookup
  const pathToModuleId = new Map<string, string>();
  const modules = new Map<string, ModuleMeta>();

  for (const row of moduleRows) {
    const relPath = row.relative_path;
    modules.set(row.id, {
      name: row.name,
      directory: row.directory,
      relativePath: relPath,
      isBarrel: toBool(row.is_barrel),
      lineCount: Number(row.line_count) || 0,
      packageId: row.package_id,
    });

    const normalizedPath = normalizePath(relPath);
    const existingId = pathToModuleId.get(normalizedPath);
    if (!existingId) {
      pathToModuleId.set(normalizedPath, row.id);
    } else {
      const existingPath = modules.get(existingId)?.relativePath;
      if (existingPath && shouldPreferCandidate(existingPath, relPath)) {
        pathToModuleId.set(normalizedPath, row.id);
      }
    }

    pathToModuleId.set(relPath, row.id);
  }

  // Fetch imports
  const importQuery = packageId
    ? 'SELECT id, module_id, source, is_type_only FROM imports WHERE package_id = ?'
    : 'SELECT id, module_id, source, is_type_only FROM imports';
  const importRows = await adapter.query<ImportRow>(importQuery, packageId ? [packageId] : []);

  // Build adjacency lists
  const adjacency = new Map<string, Set<string>>();
  const reverseAdjacency = new Map<string, Set<string>>();
  const nodeIds = new Set<string>();

  for (const moduleId of modules.keys()) {
    adjacency.set(moduleId, new Set());
    reverseAdjacency.set(moduleId, new Set());
    nodeIds.add(moduleId);
  }

  for (const imp of importRows) {
    const sourceModuleId = imp.module_id;
    const importSource = imp.source;
    if (!isInternalImport(importSource)) continue;

    const sourceModule = modules.get(sourceModuleId);
    if (!sourceModule) continue;

    // Resolve import path to a normalized lookup key
    // Use directory derived from relativePath (not the absolute `directory` column)
    const relDir = path.posix.dirname(sourceModule.relativePath);
    let resolvedPath: string;
    if (importSource.startsWith('@/')) {
      resolvedPath = normalizePath(importSource.replace('@/', 'src/'));
    } else if (importSource.startsWith('src/')) {
      resolvedPath = normalizePath(importSource);
    } else {
      resolvedPath = normalizePath(path.posix.join(relDir, importSource));
    }

    const targetModuleId = pathToModuleId.get(resolvedPath);
    if (targetModuleId && targetModuleId !== sourceModuleId) {
      adjacency.get(sourceModuleId)?.add(targetModuleId);
      reverseAdjacency.get(targetModuleId)?.add(sourceModuleId);
    }
  }

  const undirected = toUndirected(adjacency);
  return { adjacency, reverseAdjacency, undirected, modules, nodeIds };
}
