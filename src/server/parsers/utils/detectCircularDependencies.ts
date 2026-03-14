/**
 * Circular dependency detection utility.
 *
 * Builds a directed graph from module import relationships and uses
 * DFS-based cycle detection (white/gray/black coloring) to find all
 * circular dependency chains.
 */

/**
 * Represents a detected circular dependency between modules.
 */
export interface CircularDependency {
  /** Array of module paths forming the cycle (last element imports the first). */
  cycle: string[];
  /** Number of modules in the cycle. */
  length: number;
}

/**
 * Minimal module descriptor needed for dependency analysis.
 */
export interface ModuleDescriptor {
  path: string;
  imports: { source: string }[];
}

/** DFS node coloring: unvisited, in current path, or fully explored. */
const enum Color {
  White = 0,
  Gray = 1,
  Black = 2,
}

/**
 * Detects circular dependencies among a set of modules.
 *
 * Builds a directed graph where an edge from A to B means module A imports
 * module B. Runs a DFS with gray/black coloring to detect back-edges,
 * which indicate cycles.
 *
 * Only imports that resolve to a known module path are considered; external
 * or unresolvable imports are silently ignored.
 *
 * @param modules - Array of module descriptors with path and imports.
 * @returns Array of detected circular dependencies, deduplicated by canonical rotation.
 */
export function detectCircularDependencies(modules: ModuleDescriptor[]): CircularDependency[] {
  // Build adjacency list from module imports.
  // Only edges pointing to known module paths are included.
  const knownPaths = new Set(modules.map((m) => m.path));
  const adjacency = new Map<string, string[]>();

  for (const mod of modules) {
    const targets: string[] = [];
    for (const imp of mod.imports) {
      if (knownPaths.has(imp.source)) {
        targets.push(imp.source);
      }
    }
    adjacency.set(mod.path, targets);
  }

  const color = new Map<string, Color>();
  for (const path of knownPaths) {
    color.set(path, Color.White);
  }

  // Track the current DFS path for back-edge extraction.
  const pathStack: string[] = [];
  const pathSet = new Set<string>();
  const cycles: CircularDependency[] = [];
  const seenCanonical = new Set<string>();

  function dfs(node: string): void {
    color.set(node, Color.Gray);
    pathStack.push(node);
    pathSet.add(node);

    const neighbors = adjacency.get(node) ?? [];
    for (const neighbor of neighbors) {
      const neighborColor = color.get(neighbor);

      if (neighborColor === Color.Gray && pathSet.has(neighbor)) {
        // Back-edge found: extract the cycle from the path stack.
        const cycleStart = pathStack.indexOf(neighbor);
        const cycle = pathStack.slice(cycleStart);

        // Canonicalize by rotating so the lexicographically smallest element is first.
        // This prevents reporting the same cycle starting from different nodes.
        const canonical = canonicalizeCycle(cycle);
        const key = canonical.join('\0');
        if (!seenCanonical.has(key)) {
          seenCanonical.add(key);
          cycles.push({ cycle: canonical, length: canonical.length });
        }
      } else if (neighborColor === Color.White) {
        dfs(neighbor);
      }
    }

    pathStack.pop();
    pathSet.delete(node);
    color.set(node, Color.Black);
  }

  for (const path of knownPaths) {
    if (color.get(path) === Color.White) {
      dfs(path);
    }
  }

  return cycles;
}

/**
 * Rotates a cycle array so that the lexicographically smallest element comes first.
 * This provides a canonical form for deduplication.
 */
function canonicalizeCycle(cycle: string[]): string[] {
  if (cycle.length === 0) {
    return cycle;
  }

  let minIndex = 0;
  for (let i = 1; i < cycle.length; i++) {
    const current = cycle[i];
    const min = cycle[minIndex];
    if (current !== undefined && min !== undefined && current < min) {
      minIndex = i;
    }
  }

  return [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)];
}
