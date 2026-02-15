/**
 * Path normalization and module/package lookups for graph edge creation.
 * Used by createGraphEdges.
 */

import { mapTypeCollection } from './collections';

import type { DependencyPackageGraph } from '../types/DependencyPackageGraph';
import type { ModuleStructure } from '../types/ModuleStructure';
import type { PackageStructure } from '../types/PackageStructure';

export interface ModulePathLookup {
  packagePathMap: Map<string, Map<string, string>>;
  globalPathMap: Map<string, Set<string>>;
}

export function isExternalImportRef(imp: {
  isExternal?: boolean;
  packageName?: string;
  path?: string | undefined;
}): boolean {
  if (imp.isExternal === true) return true;
  if (typeof imp.packageName === 'string' && imp.packageName.length > 0) return true;
  const path = imp.path;
  if (!path) return false;
  if (!path.startsWith('.') && !path.startsWith('/') && !path.startsWith('@/') && !path.startsWith('src/')) {
    return true;
  }
  return false;
}

export const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'] as const;
export const FILE_EXTENSION_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|vue)$/i;
export const INDEX_FILE_PATTERN = /^(.*)\/index\.(ts|tsx|js|jsx|mjs|cjs|vue)$/i;

export function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (part === '..') result.pop();
    else if (part !== '.' && part !== '') result.push(part);
  }
  return result.join('/');
}

export function getDirname(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash > 0 ? normalized.substring(0, lastSlash) : '';
}

export function joinPaths(...segments: string[]): string {
  return normalizePath(segments.join('/'));
}

export function generatePathVariants(normalizedPath: string): string[] {
  const variants = [normalizedPath];
  const withoutExt = normalizedPath.replace(FILE_EXTENSION_PATTERN, '');
  if (withoutExt !== normalizedPath) variants.push(withoutExt);
  const indexMatch = RegExp.prototype.exec.call(INDEX_FILE_PATTERN, normalizedPath);
  if (indexMatch?.[1]) variants.push(indexMatch[1]);
  return Array.from(new Set(variants));
}

function addModulePathEntry(pathMap: Map<string, string>, relativePath: string, moduleId: string): void {
  const normalizedPath = normalizePath(relativePath);
  for (const variant of generatePathVariants(normalizedPath)) {
    pathMap.set(variant, moduleId);
  }
}

export function buildModulePathLookup(data: DependencyPackageGraph): ModulePathLookup {
  const packagePathMap = new Map<string, Map<string, string>>();
  const globalPathMap = new Map<string, Set<string>>();

  data.packages.forEach((pkg: PackageStructure) => {
    const pathMap = new Map<string, string>();
    packagePathMap.set(pkg.id, pathMap);
    if (!pkg.modules) return;
    mapTypeCollection(pkg.modules, (module: ModuleStructure) => {
      const relativePath: string = module.source.relativePath;
      const moduleId: string = module.id;
      addModulePathEntry(pathMap, relativePath, moduleId);
      for (const variant of generatePathVariants(normalizePath(relativePath))) {
        const existing = globalPathMap.get(variant);
        if (existing) existing.add(moduleId);
        else globalPathMap.set(variant, new Set<string>([moduleId]));
      }
    });
  });

  return { packagePathMap, globalPathMap };
}

export function getPackagePrefixFromImporter(importerPath: string): string | undefined {
  const normalized = normalizePath(importerPath);
  const marker = '/src/';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex <= 0) return undefined;
  return normalized.slice(0, markerIndex);
}

export function expandCandidatePath(path: string): string[] {
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

export function resolveRelativeCandidates(importerPath: string, importPath: string): string[] {
  const importerDir = getDirname(importerPath);
  const resolvedBasePath = joinPaths(importerDir, importPath);
  return expandCandidatePath(resolvedBasePath);
}

export function resolveNonRelativeCandidates(importerPath: string, importPath: string): string[] {
  const normalizedImportPath = normalizePath(importPath);
  const baseCandidates = new Set<string>();
  const packagePrefix = getPackagePrefixFromImporter(importerPath);
  if (normalizedImportPath.startsWith('@/')) {
    const suffix = normalizedImportPath.slice(2);
    baseCandidates.add(`src/${suffix}`);
    if (packagePrefix) baseCandidates.add(`${packagePrefix}/src/${suffix}`);
  } else if (normalizedImportPath.startsWith('src/')) {
    baseCandidates.add(normalizedImportPath);
    if (packagePrefix) baseCandidates.add(`${packagePrefix}/${normalizedImportPath}`);
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

export function resolveModuleId(
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
    if (packageMatch) return packageMatch;
    const globalMatches = lookup.globalPathMap.get(normalized);
    if (globalMatches?.size === 1) {
      const [globalMatch] = Array.from(globalMatches);
      return globalMatch;
    }
  }
  return undefined;
}
