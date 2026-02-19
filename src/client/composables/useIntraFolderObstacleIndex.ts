import { computed } from 'vue';
import { useVueFlow } from '@vue-flow/core';
import type { ObstacleRect } from '../layout/orthogonalPathfinder';

export interface FolderObstacleSnapshot {
  folderId: string;
  ready: boolean;
  version: string;
  obstacles: (ObstacleRect & { nodeId: string })[];
}

export interface IntraFolderObstacleIndex {
  getSnapshot(folderId: string): FolderObstacleSnapshot | null;
}

/**
 * Simple non-cryptographic string hash.
 * Produces a deterministic base-36 string from the input.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

/**
 * Provides a shared, reactive index of obstacle rectangles grouped by folder.
 *
 * Each folder gets a {@link FolderObstacleSnapshot} with a deterministic version
 * hash derived solely from same-folder geometry. Edge components can use the
 * version string for efficient cache invalidation without scanning all nodes.
 */
export function useIntraFolderObstacleIndex(): IntraFolderObstacleIndex {
  const { getNodes } = useVueFlow();

  const folderIndex = computed<Map<string, FolderObstacleSnapshot>>(() => {
    const nodes = getNodes.value;

    // Group nodes by their parentNode (folder). Skip nodes without a parent.
    const folderGroups = new Map<string, { nodeId: string; x: number; y: number; width: number; height: number }[]>();

    for (const node of nodes) {
      const folderId = node.parentNode;
      if (!folderId) {
        continue;
      }

      const x = node.computedPosition.x;
      const y = node.computedPosition.y;
      const width = node.dimensions.width;
      const height = node.dimensions.height;

      let group = folderGroups.get(folderId);
      if (!group) {
        group = [];
        folderGroups.set(folderId, group);
      }

      group.push({ nodeId: node.id, x, y, width, height });
    }

    // Build a snapshot for each folder group.
    const index = new Map<string, FolderObstacleSnapshot>();

    for (const [folderId, group] of folderGroups) {
      // Determine readiness: all nodes must have measured dimensions (width > 0 AND height > 0).
      let ready = true;
      for (const entry of group) {
        if (entry.width <= 0 || entry.height <= 0) {
          ready = false;
          break;
        }
      }

      // Build obstacles array.
      const obstacles: (ObstacleRect & { nodeId: string })[] = group.map((entry) => ({
        x: entry.x,
        y: entry.y,
        width: entry.width,
        height: entry.height,
        nodeId: entry.nodeId,
      }));

      // Build a deterministic version hash from sorted geometry tuples.
      // Sorting by nodeId ensures stability regardless of iteration order.
      const sortedEntries = [...group].sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));
      const versionInput = sortedEntries
        .map((entry) =>
          [entry.nodeId, entry.x, entry.y, entry.width, entry.height].join(':'),
        )
        .join('|');
      const version = simpleHash(versionInput);

      index.set(folderId, { folderId, ready, version, obstacles });
    }

    return index;
  });

  return {
    getSnapshot(folderId: string): FolderObstacleSnapshot | null {
      return folderIndex.value.get(folderId) ?? null;
    },
  };
}
