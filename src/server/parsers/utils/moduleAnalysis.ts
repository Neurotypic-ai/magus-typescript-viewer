/**
 * Analysis utilities for module-level insights.
 *
 * Provides complexity metrics computation and dead export detection
 * to enhance the parser's analysis capabilities.
 */

export interface ModuleComplexityMetrics {
  /** Number of exported symbols */
  exportCount: number;
  /** Number of imported symbols */
  importCount: number;
  /** Number of re-exports */
  reExportCount: number;
  /** Whether this is likely a barrel/index file */
  isBarrelFile: boolean;
  /** Ratio of re-exports to total exports */
  reExportRatio: number;
  /** Number of distinct import sources */
  importSourceCount: number;
  /** Fan-out: how many other modules this depends on */
  fanOut: number;
}

/**
 * Compute complexity metrics for a module based on its parse result.
 *
 * Uses the same barrel-file heuristic as `isBarrelFile` in
 * `parseImportsExports.ts`: a module is a barrel if it has a wildcard
 * re-export or more than 80% of its exports are re-exports.
 *
 * @param exports - Set of exported symbol names (including re-exports).
 * @param reExports - Set of re-exported symbol names (subset of exports).
 * @param imports - Map of import path to import data.
 * @param importSources - Set of distinct import source paths.
 * @returns Computed complexity metrics for the module.
 */
export function computeModuleMetrics(
  exports: Set<string>,
  reExports: Set<string>,
  imports: Map<string, unknown>,
  importSources: Set<string>
): ModuleComplexityMetrics {
  const exportCount = exports.size;
  const reExportCount = reExports.size;
  const importCount = imports.size;
  const importSourceCount = importSources.size;

  const reExportRatio = exportCount > 0 ? reExportCount / exportCount : 0;

  // Mirror the barrel-file heuristic from parseImportsExports.ts:
  // wildcard re-export OR >80% re-export ratio.
  const isBarrelFile =
    exportCount > 0 && (reExports.has('*') || reExportRatio > 0.8);

  // Fan-out is the number of distinct modules this module depends on.
  const fanOut = importSourceCount;

  return {
    exportCount,
    importCount,
    reExportCount,
    isBarrelFile,
    reExportRatio,
    importSourceCount,
    fanOut,
  };
}

export interface DeadExport {
  /** The exported symbol name */
  name: string;
  /** The module that exports it */
  modulePath: string;
}

/**
 * Minimal module descriptor for dead-export analysis.
 */
export interface ModuleExportDescriptor {
  path: string;
  exports: Set<string>;
  imports: { source: string; specifiers: string[] }[];
}

/**
 * Detect exports that are never imported by any other module.
 * Requires the full set of parsed modules to cross-reference.
 *
 * A symbol is considered "dead" if no other module imports it by name.
 * Wildcard imports (`import *`) are not tracked, so modules consumed
 * only via wildcards may produce false positives.
 *
 * @param modules - Array of module descriptors with exports and imports.
 * @returns Array of dead exports sorted by module path then symbol name.
 */
export function detectDeadExports(modules: ModuleExportDescriptor[]): DeadExport[] {
  // Build a set of all (source, specifier) pairs that are imported somewhere.
  const importedSymbols = new Map<string, Set<string>>();

  for (const mod of modules) {
    for (const imp of mod.imports) {
      let symbols = importedSymbols.get(imp.source);
      if (!symbols) {
        symbols = new Set<string>();
        importedSymbols.set(imp.source, symbols);
      }
      for (const specifier of imp.specifiers) {
        symbols.add(specifier);
      }
    }
  }

  // Check each module's exports against what is imported.
  const deadExports: DeadExport[] = [];

  for (const mod of modules) {
    const consumed = importedSymbols.get(mod.path);

    for (const exportName of mod.exports) {
      if (!consumed?.has(exportName)) {
        deadExports.push({ name: exportName, modulePath: mod.path });
      }
    }
  }

  // Sort for deterministic output: by module path, then symbol name.
  deadExports.sort((a, b) => {
    const pathCmp = a.modulePath.localeCompare(b.modulePath);
    if (pathCmp !== 0) return pathCmp;
    return a.name.localeCompare(b.name);
  });

  return deadExports;
}
