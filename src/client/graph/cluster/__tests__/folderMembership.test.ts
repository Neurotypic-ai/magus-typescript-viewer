import {
  buildParentMap,
  findCollapsedAncestor,
  buildNodeToFolderMap,
  getAncestorFolders,
} from '../folderMembership';

import type { DependencyNode } from '../../../types/DependencyNode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: string = 'module',
  parentNode?: string
): DependencyNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: id },
    ...(parentNode ? { parentNode } : {}),
  } as DependencyNode;
}

// ---------------------------------------------------------------------------
// buildParentMap
// ---------------------------------------------------------------------------

describe('buildParentMap', () => {
  it('maps each node to its parentNode', () => {
    const nodes = [
      makeNode('folder-a', 'group'),
      makeNode('m1', 'module', 'folder-a'),
      makeNode('m2', 'module', 'folder-a'),
    ];

    const parentMap = buildParentMap(nodes);

    expect(parentMap.get('m1')).toBe('folder-a');
    expect(parentMap.get('m2')).toBe('folder-a');
  });

  it('excludes root-level nodes that have no parentNode', () => {
    const nodes = [
      makeNode('root-module', 'module'),
      makeNode('child', 'module', 'root-module'),
    ];

    const parentMap = buildParentMap(nodes);

    expect(parentMap.has('root-module')).toBe(false);
    expect(parentMap.get('child')).toBe('root-module');
  });

  it('returns an empty map when all nodes are root-level', () => {
    const nodes = [
      makeNode('a', 'module'),
      makeNode('b', 'module'),
    ];

    const parentMap = buildParentMap(nodes);

    expect(parentMap.size).toBe(0);
  });

  it('returns an empty map for an empty node array', () => {
    const parentMap = buildParentMap([]);

    expect(parentMap.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findCollapsedAncestor
// ---------------------------------------------------------------------------

describe('findCollapsedAncestor', () => {
  it('returns undefined when the node has no parent', () => {
    const parentMap = new Map<string, string>();
    const collapsed = new Set(['some-folder']);

    const result = findCollapsedAncestor('orphan', parentMap, collapsed);

    expect(result).toBeUndefined();
  });

  it('returns undefined when no ancestor is collapsed', () => {
    const parentMap = new Map([
      ['m1', 'folder-a'],
      ['folder-a', 'root'],
    ]);
    const collapsed = new Set<string>();

    const result = findCollapsedAncestor('m1', parentMap, collapsed);

    expect(result).toBeUndefined();
  });

  it('returns the immediate parent when it is collapsed', () => {
    const parentMap = new Map([
      ['m1', 'folder-a'],
    ]);
    const collapsed = new Set(['folder-a']);

    const result = findCollapsedAncestor('m1', parentMap, collapsed);

    expect(result).toBe('folder-a');
  });

  it('returns the outermost collapsed ancestor in a deep chain', () => {
    // hierarchy: root -> mid -> leaf -> m1
    const parentMap = new Map([
      ['m1', 'leaf'],
      ['leaf', 'mid'],
      ['mid', 'root'],
    ]);
    // both mid and root are collapsed, but root is outermost
    const collapsed = new Set(['mid', 'root']);

    const result = findCollapsedAncestor('m1', parentMap, collapsed);

    expect(result).toBe('root');
  });

  it('returns only the collapsed ancestor, skipping non-collapsed intermediates', () => {
    // hierarchy: root(collapsed) -> mid(not collapsed) -> leaf(collapsed) -> m1
    const parentMap = new Map([
      ['m1', 'leaf'],
      ['leaf', 'mid'],
      ['mid', 'root'],
    ]);
    const collapsed = new Set(['leaf', 'root']);

    const result = findCollapsedAncestor('m1', parentMap, collapsed);

    // root is the outermost collapsed ancestor
    expect(result).toBe('root');
  });

  it('returns the single collapsed ancestor when only one ancestor is collapsed', () => {
    const parentMap = new Map([
      ['m1', 'leaf'],
      ['leaf', 'mid'],
      ['mid', 'root'],
    ]);
    const collapsed = new Set(['mid']);

    const result = findCollapsedAncestor('m1', parentMap, collapsed);

    expect(result).toBe('mid');
  });

  it('does not return the node itself even if it is in the collapsed set', () => {
    // findCollapsedAncestor walks the *parent* chain, never the node itself
    const parentMap = new Map<string, string>();
    const collapsed = new Set(['m1']);

    const result = findCollapsedAncestor('m1', parentMap, collapsed);

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildNodeToFolderMap
// ---------------------------------------------------------------------------

describe('buildNodeToFolderMap', () => {
  it('maps module nodes to their nearest group ancestor', () => {
    const nodes = [
      makeNode('folder-a', 'group'),
      makeNode('m1', 'module', 'folder-a'),
      makeNode('m2', 'module', 'folder-a'),
    ];

    const folderMap = buildNodeToFolderMap(nodes);

    expect(folderMap.get('m1')).toBe('folder-a');
    expect(folderMap.get('m2')).toBe('folder-a');
  });

  it('does not include root-level modules that have no group ancestor', () => {
    const nodes = [
      makeNode('root-module', 'module'),
      makeNode('folder-a', 'group'),
      makeNode('child', 'module', 'folder-a'),
    ];

    const folderMap = buildNodeToFolderMap(nodes);

    expect(folderMap.has('root-module')).toBe(false);
    expect(folderMap.get('child')).toBe('folder-a');
  });

  it('maps deeply nested nodes to the nearest group', () => {
    // hierarchy: outer-group -> inner-group -> m1
    const nodes = [
      makeNode('outer-group', 'group'),
      makeNode('inner-group', 'group', 'outer-group'),
      makeNode('m1', 'module', 'inner-group'),
    ];

    const folderMap = buildNodeToFolderMap(nodes);

    // nearest group ancestor of m1 is inner-group
    expect(folderMap.get('m1')).toBe('inner-group');
  });

  it('skips non-group intermediate ancestors when looking for nearest group', () => {
    // hierarchy: group-a -> container-module -> m1
    // container-module is type 'module', not 'group'
    const nodes = [
      makeNode('group-a', 'group'),
      makeNode('container-module', 'module', 'group-a'),
      makeNode('m1', 'module', 'container-module'),
    ];

    const folderMap = buildNodeToFolderMap(nodes);

    // m1's parent is container-module (type=module), so it walks up to group-a
    expect(folderMap.get('m1')).toBe('group-a');
  });

  it('returns empty map when there are no group nodes', () => {
    const nodes = [
      makeNode('m1', 'module'),
      makeNode('m2', 'module'),
    ];

    const folderMap = buildNodeToFolderMap(nodes);

    expect(folderMap.size).toBe(0);
  });

  it('returns empty map for an empty node array', () => {
    const folderMap = buildNodeToFolderMap([]);

    expect(folderMap.size).toBe(0);
  });

  it('maps group children to their parent group folder', () => {
    // group nodes themselves can be children of other groups
    const nodes = [
      makeNode('root-group', 'group'),
      makeNode('child-group', 'group', 'root-group'),
    ];

    const folderMap = buildNodeToFolderMap(nodes);

    // child-group's nearest group ancestor is root-group
    expect(folderMap.get('child-group')).toBe('root-group');
  });
});

// ---------------------------------------------------------------------------
// getAncestorFolders
// ---------------------------------------------------------------------------

describe('getAncestorFolders', () => {
  it('returns empty array for a node with no parents', () => {
    const parentMap = new Map<string, string>();
    const nodeById = new Map<string, DependencyNode>();

    const result = getAncestorFolders('orphan', parentMap, nodeById);

    expect(result).toEqual([]);
  });

  it('returns empty array when ancestors exist but none are groups', () => {
    const nodes = [
      makeNode('root', 'module'),
      makeNode('mid', 'module', 'root'),
      makeNode('m1', 'module', 'mid'),
    ];
    const parentMap = buildParentMap(nodes);
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const result = getAncestorFolders('m1', parentMap, nodeById);

    expect(result).toEqual([]);
  });

  it('returns ancestor folders from nearest to outermost', () => {
    const nodes = [
      makeNode('outer', 'group'),
      makeNode('inner', 'group', 'outer'),
      makeNode('m1', 'module', 'inner'),
    ];
    const parentMap = buildParentMap(nodes);
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const result = getAncestorFolders('m1', parentMap, nodeById);

    expect(result).toEqual(['inner', 'outer']);
  });

  it('skips non-group ancestors in the chain', () => {
    const nodes = [
      makeNode('outer-group', 'group'),
      makeNode('container', 'module', 'outer-group'),
      makeNode('inner-group', 'group', 'container'),
      makeNode('m1', 'module', 'inner-group'),
    ];
    const parentMap = buildParentMap(nodes);
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const result = getAncestorFolders('m1', parentMap, nodeById);

    // inner-group (nearest), then outer-group (outermost); container is skipped (type=module)
    expect(result).toEqual(['inner-group', 'outer-group']);
  });

  it('handles a single group ancestor', () => {
    const nodes = [
      makeNode('folder', 'group'),
      makeNode('m1', 'module', 'folder'),
    ];
    const parentMap = buildParentMap(nodes);
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const result = getAncestorFolders('m1', parentMap, nodeById);

    expect(result).toEqual(['folder']);
  });

  it('handles deeply nested groups (3+ levels)', () => {
    const nodes = [
      makeNode('level0', 'group'),
      makeNode('level1', 'group', 'level0'),
      makeNode('level2', 'group', 'level1'),
      makeNode('level3', 'group', 'level2'),
      makeNode('m1', 'module', 'level3'),
    ];
    const parentMap = buildParentMap(nodes);
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const result = getAncestorFolders('m1', parentMap, nodeById);

    expect(result).toEqual(['level3', 'level2', 'level1', 'level0']);
  });
});
