/**
 * Tarjan's algorithm to find strongly connected components.
 * Returns arrays of node IDs — only SCCs with size > 1 (actual cycles).
 */
export function findStronglyConnectedComponents(adjacency: Map<string, Set<string>>): string[][] {
  const indexMap = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const stack: string[] = [];
  let index = 0;
  const result: string[][] = [];

  function strongConnect(v: string): void {
    indexMap.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.set(v, true);

    const neighbors = adjacency.get(v);
    if (neighbors) {
      neighbors.forEach((w) => {
        if (!indexMap.has(w)) {
          strongConnect(w);
          const lw = lowlink.get(w) ?? 0;
          const lv = lowlink.get(v) ?? 0;
          lowlink.set(v, Math.min(lv, lw));
        } else if (onStack.get(w)) {
          const iw = indexMap.get(w) ?? 0;
          const lv = lowlink.get(v) ?? 0;
          lowlink.set(v, Math.min(lv, iw));
        }
      });
    }

    if (lowlink.get(v) === indexMap.get(v)) {
      const members: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w !== undefined) {
          onStack.set(w, false);
          members.push(w);
        }
      } while (w !== undefined && w !== v);

      if (members.length > 1) {
        result.push(members);
      }
    }
  }

  Array.from(adjacency.keys()).forEach((v) => {
    if (!indexMap.has(v)) strongConnect(v);
  });

  return result;
}

/**
 * Find articulation points (cut vertices) in the undirected version of a directed graph.
 * Removing an articulation point disconnects the graph — these are "bridge modules."
 */
export function findArticulationPoints(adjacency: Map<string, Set<string>>): Set<string> {
  const undirected = new Map<string, Set<string>>();
  adjacency.forEach((neighbors, node) => {
    if (!undirected.has(node)) undirected.set(node, new Set());
    neighbors.forEach((neighbor) => {
      const nodeSet = undirected.get(node);
      if (nodeSet) nodeSet.add(neighbor);
      if (!undirected.has(neighbor)) undirected.set(neighbor, new Set());
      const neighborSet = undirected.get(neighbor);
      if (neighborSet) neighborSet.add(node);
    });
  });

  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const points = new Set<string>();
  let time = 0;

  function dfs(u: string): void {
    let children = 0;
    disc.set(u, time);
    low.set(u, time);
    time++;

    const neighbors = undirected.get(u);
    if (neighbors) {
      neighbors.forEach((v) => {
        if (!disc.has(v)) {
          children++;
          parent.set(v, u);
          dfs(v);
          const lowU = low.get(u) ?? 0;
          const lowV = low.get(v) ?? 0;
          low.set(u, Math.min(lowU, lowV));

          if (parent.get(u) === null && children > 1) {
            points.add(u);
          }
          if (parent.get(u) !== null && lowV >= (disc.get(u) ?? 0)) {
            points.add(u);
          }
        } else if (v !== parent.get(u)) {
          const lowU = low.get(u) ?? 0;
          const discV = disc.get(v) ?? 0;
          low.set(u, Math.min(lowU, discV));
        }
      });
    }
  }

  Array.from(undirected.keys()).forEach((node) => {
    if (!disc.has(node)) {
      parent.set(node, null);
      dfs(node);
    }
  });

  return points;
}

/**
 * Label propagation for community detection on the undirected graph.
 * Returns a map of node ID to community label (number).
 */
export function detectCommunities(adjacency: Map<string, Set<string>>, maxIterations = 10): Map<string, number> {
  const undirected = new Map<string, Set<string>>();
  adjacency.forEach((neighbors, node) => {
    if (!undirected.has(node)) undirected.set(node, new Set());
    neighbors.forEach((neighbor) => {
      const nodeSet = undirected.get(node);
      if (nodeSet) nodeSet.add(neighbor);
      if (!undirected.has(neighbor)) undirected.set(neighbor, new Set());
      const neighborSet = undirected.get(neighbor);
      if (neighborSet) neighborSet.add(node);
    });
  });

  const labels = new Map<string, number>();
  const nodes = Array.from(undirected.keys());
  nodes.forEach((node, i) => labels.set(node, i));

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let changed = false;

    // Fisher-Yates shuffle
    for (let i = nodes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = nodes[i];
      const b = nodes[j];
      if (a !== undefined && b !== undefined) {
        nodes[i] = b;
        nodes[j] = a;
      }
    }

    for (const node of nodes) {
      const neighbors = undirected.get(node);
      if (!neighbors || neighbors.size === 0) continue;

      const labelCounts = new Map<number, number>();
      neighbors.forEach((neighbor) => {
        const label = labels.get(neighbor) ?? 0;
        labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      });

      let maxCount = 0;
      let bestLabel = labels.get(node) ?? 0;
      labelCounts.forEach((count, label) => {
        if (count > maxCount) {
          maxCount = count;
          bestLabel = label;
        }
      });

      if (bestLabel !== labels.get(node)) {
        labels.set(node, bestLabel);
        changed = true;
      }
    }

    if (!changed) break;
  }

  return labels;
}
