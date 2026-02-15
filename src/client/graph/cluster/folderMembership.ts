import type { DependencyNode } from '../../types';

/** Build nodeId -> immediate parentNode map. */
export function buildParentMap(nodes: DependencyNode[]): Map<string, string> {
  const parentMap = new Map<string, string>();
  for (const node of nodes) {
    if (node.parentNode) {
      parentMap.set(node.id, node.parentNode);
    }
  }
  return parentMap;
}

/** Find outermost collapsed ancestor for a node. */
export function findCollapsedAncestor(
  nodeId: string,
  parentMap: Map<string, string>,
  collapsedIds: Set<string>
): string | undefined {
  let current = nodeId;
  let collapsedAncestor: string | undefined;

  for (let parent = parentMap.get(current); parent !== undefined; parent = parentMap.get(current)) {
    if (collapsedIds.has(parent)) {
      collapsedAncestor = parent;
    }
    current = parent;
  }

  return collapsedAncestor;
}

/** Map each node to its nearest ancestor folder (group node). */
export function buildNodeToFolderMap(nodes: DependencyNode[]): Map<string, string> {
  const parentMap = buildParentMap(nodes);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeToFolder = new Map<string, string>();

  for (const node of nodes) {
    let current = node.id;
    let parent = parentMap.get(current);

    while (parent) {
      const parentNode = nodeById.get(parent);
      if (parentNode?.type === 'group') {
        nodeToFolder.set(node.id, parent);
        break;
      }
      current = parent;
      parent = parentMap.get(current);
    }
  }

  return nodeToFolder;
}

/** Walk up parent chain and return all ancestor folders from nearest to outermost. */
export function getAncestorFolders(
  nodeId: string,
  parentMap: Map<string, string>,
  nodeById: Map<string, DependencyNode>
): string[] {
  const folders: string[] = [];
  let current = nodeId;
  let parent = parentMap.get(current);

  while (parent) {
    const parentNode = nodeById.get(parent);
    if (parentNode?.type === 'group') {
      folders.push(parent);
    }
    current = parent;
    parent = parentMap.get(current);
  }

  return folders;
}

