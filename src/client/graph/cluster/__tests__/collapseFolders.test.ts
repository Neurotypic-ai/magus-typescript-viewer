import { buildChildToFolderMap, collapseFolders } from '../collapseFolders';

import type { DependencyNode } from '../../../types/DependencyNode';
import type { GraphEdge } from '../../../types/GraphEdge';

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

function makeEdge(
  id: string,
  source: string,
  target: string,
  edgeType: string = 'dependency',
  extra: Record<string, unknown> = {}
): GraphEdge {
  return {
    id,
    source,
    target,
    data: { type: edgeType, ...extra },
  } as GraphEdge;
}

// ---------------------------------------------------------------------------
// buildChildToFolderMap
// ---------------------------------------------------------------------------

describe('buildChildToFolderMap', () => {
  it('maps child nodes to their collapsed ancestor folder', () => {
    const nodes = [
      makeNode('folder-a', 'group'),
      makeNode('m1', 'module', 'folder-a'),
      makeNode('m2', 'module', 'folder-a'),
    ];
    const collapsed = new Set(['folder-a']);

    const map = buildChildToFolderMap(nodes, collapsed);

    expect(map.get('m1')).toBe('folder-a');
    expect(map.get('m2')).toBe('folder-a');
  });

  it('does not include the collapsed folder itself in the map', () => {
    const nodes = [
      makeNode('folder-a', 'group'),
      makeNode('m1', 'module', 'folder-a'),
    ];
    const collapsed = new Set(['folder-a']);

    const map = buildChildToFolderMap(nodes, collapsed);

    expect(map.has('folder-a')).toBe(false);
  });

  it('returns empty map when no folders are collapsed', () => {
    const nodes = [
      makeNode('folder-a', 'group'),
      makeNode('m1', 'module', 'folder-a'),
    ];
    const collapsed = new Set<string>();

    const map = buildChildToFolderMap(nodes, collapsed);

    expect(map.size).toBe(0);
  });

  it('maps nodes to outermost collapsed ancestor when multiple ancestors are collapsed', () => {
    const nodes = [
      makeNode('outer', 'group'),
      makeNode('inner', 'group', 'outer'),
      makeNode('m1', 'module', 'inner'),
    ];
    // both outer and inner are collapsed — outermost wins
    const collapsed = new Set(['outer', 'inner']);

    const map = buildChildToFolderMap(nodes, collapsed);

    expect(map.get('m1')).toBe('outer');
    // inner is itself in collapsedFolderIds, so it is skipped by buildChildToFolderMap
    expect(map.has('inner')).toBe(false);
  });

  it('does not map nodes outside of collapsed folders', () => {
    const nodes = [
      makeNode('folder-a', 'group'),
      makeNode('m1', 'module', 'folder-a'),
      makeNode('folder-b', 'group'),
      makeNode('m2', 'module', 'folder-b'),
      makeNode('m3', 'module'),
    ];
    // only folder-a is collapsed
    const collapsed = new Set(['folder-a']);

    const map = buildChildToFolderMap(nodes, collapsed);

    expect(map.get('m1')).toBe('folder-a');
    expect(map.has('m2')).toBe(false);
    expect(map.has('m3')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// collapseFolders — node filtering
// ---------------------------------------------------------------------------

describe('collapseFolders', () => {
  describe('pass-through when nothing is collapsed', () => {
    it('returns nodes and edges unchanged', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
      ];
      const edges = [makeEdge('e1', 'm1', 'folder-a')];
      const collapsed = new Set<string>();

      const result = collapseFolders(nodes, edges, collapsed);

      expect(result.nodes).toBe(nodes);
      expect(result.edges).toBe(edges);
      expect(result.collapsedMeta.size).toBe(0);
    });
  });

  describe('node filtering', () => {
    it('hides children of collapsed folders', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module', 'folder-a'),
        makeNode('m3', 'module'),
      ];
      const edges: GraphEdge[] = [];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);
      const nodeIds = result.nodes.map((n) => n.id);

      expect(nodeIds).toContain('folder-a');
      expect(nodeIds).toContain('m3');
      expect(nodeIds).not.toContain('m1');
      expect(nodeIds).not.toContain('m2');
    });

    it('marks collapsed folder with isCollapsed and childCount data', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module', 'folder-a'),
      ];
      const edges: GraphEdge[] = [];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);
      const folderNode = result.nodes.find((n) => n.id === 'folder-a');

      expect(folderNode).toBeDefined();
      expect(folderNode?.data.isCollapsed).toBe(true);
      expect(folderNode?.data.childCount).toBe(2);
    });

    it('records child IDs in collapsedMeta', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module', 'folder-a'),
      ];
      const edges: GraphEdge[] = [];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);
      const meta = result.collapsedMeta.get('folder-a');

      expect(meta).toBeDefined();
      expect(meta?.childIds).toContain('m1');
      expect(meta?.childIds).toContain('m2');
      expect(meta?.childIds).toHaveLength(2);
    });

    it('preserves non-collapsed nodes without modification', () => {
      const externalNode = makeNode('m3', 'module');
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        externalNode,
      ];
      const edges: GraphEdge[] = [];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);
      const m3 = result.nodes.find((n) => n.id === 'm3');

      expect(m3).toBe(externalNode);
    });
  });

  describe('edge rewiring', () => {
    it('rewires edges from hidden child to collapsed folder', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module'),
      ];
      const edges = [makeEdge('e1', 'm1', 'm2', 'import')];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]?.source).toBe('folder-a');
      expect(result.edges[0]?.target).toBe('m2');
    });

    it('rewires edges targeting hidden child to collapsed folder', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module'),
      ];
      const edges = [makeEdge('e1', 'm2', 'm1', 'import')];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]?.source).toBe('m2');
      expect(result.edges[0]?.target).toBe('folder-a');
    });

    it('drops intra-folder edges (both endpoints map to same folder)', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module', 'folder-a'),
      ];
      const edges = [makeEdge('e1', 'm1', 'm2', 'import')];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);

      expect(result.edges).toHaveLength(0);
    });

    it('deduplicates lifted edges with same source, target, and type', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module', 'folder-a'),
        makeNode('m3', 'module'),
      ];
      // Both m1 and m2 have import edges to m3 — should collapse to one
      const edges = [
        makeEdge('e1', 'm1', 'm3', 'import'),
        makeEdge('e2', 'm2', 'm3', 'import'),
      ];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]?.source).toBe('folder-a');
      expect(result.edges[0]?.target).toBe('m3');
    });

    it('keeps edges with different types as separate after remapping', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m3', 'module'),
      ];
      const edges = [
        makeEdge('e1', 'm1', 'm3', 'import'),
        makeEdge('e2', 'm1', 'm3', 'inheritance'),
      ];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);

      expect(result.edges).toHaveLength(2);
      const types = result.edges.map((e) => e.data?.type);
      expect(types).toContain('import');
      expect(types).toContain('inheritance');
    });

    it('clears source/target handles when endpoint is remapped', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module'),
      ];
      const edges: GraphEdge[] = [{
        id: 'e1',
        source: 'm1',
        target: 'm2',
        sourceHandle: 'folder-left-out',
        targetHandle: 'folder-right-in',
        data: { type: 'import' },
      } as GraphEdge];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);

      expect(result.edges).toHaveLength(1);
      // source was remapped, so sourceHandle is cleared
      expect(result.edges[0]?.sourceHandle).toBeNull();
      // target was not remapped, so targetHandle is preserved
      expect(result.edges[0]?.targetHandle).toBe('folder-right-in');
    });

    it('preserves edges that are not affected by collapsing', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module'),
        makeNode('m3', 'module'),
      ];
      const edges = [
        makeEdge('e1', 'm1', 'm2', 'import'),
        makeEdge('e2', 'm2', 'm3', 'dependency'),
      ];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);

      // e1 is remapped, e2 is preserved unchanged
      const e2 = result.edges.find((e) => e.source === 'm2' && e.target === 'm3');
      expect(e2).toBeDefined();
      expect(e2?.data?.type).toBe('dependency');
    });
  });

  describe('highway segment handling', () => {
    it('drops entry/exit highway edges when they are remapped', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module'),
      ];
      const edges: GraphEdge[] = [
        makeEdge('exit-edge', 'm1', 'm2', 'import', { highwaySegment: 'exit' }),
        makeEdge('entry-edge', 'm2', 'm1', 'import', { highwaySegment: 'entry' }),
      ];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);

      // Both should be dropped because their endpoints are being remapped
      expect(result.edges).toHaveLength(0);
    });

    it('keeps highway trunk edges even when endpoints are remapped', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module'),
      ];
      const edges: GraphEdge[] = [
        makeEdge('trunk-edge', 'm1', 'm2', 'import', { highwaySegment: 'highway' }),
      ];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);

      // Trunk edges are kept even when remapped
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]?.source).toBe('folder-a');
    });

    it('keeps entry/exit highway edges when neither endpoint is remapped', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module'),
        makeNode('m3', 'module'),
      ];
      const edges: GraphEdge[] = [
        makeEdge('exit-edge', 'm2', 'm3', 'import', { highwaySegment: 'exit' }),
      ];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);

      // m2->m3 is not remapped, so the exit edge survives
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]?.source).toBe('m2');
      expect(result.edges[0]?.target).toBe('m3');
    });
  });

  describe('lifted edge count tracking', () => {
    it('records total lifted edge count in collapsedMeta', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module'),
      ];
      const edges = [makeEdge('e1', 'm1', 'm2', 'import')];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);
      const meta = result.collapsedMeta.get('folder-a');

      expect(meta).toBeDefined();
      expect(meta?.liftedEdgeCount).toBeGreaterThan(0);
    });

    it('reports zero lifted edges when all edges are intra-folder', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module', 'folder-a'),
      ];
      // intra-folder edge — gets dropped, not lifted
      const edges = [makeEdge('e1', 'm1', 'm2', 'import')];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);
      const meta = result.collapsedMeta.get('folder-a');

      expect(meta).toBeDefined();
      // The intra-folder edge was remapped but then dropped (same source/target),
      // so it is not counted as a lifted edge because the remapped check
      // happens before the intra-folder drop
      // Actually looking at the code: wasRemapped increments totalLifted before the
      // intra-folder check. But the intra-folder check skips via `continue` before
      // the dedup logic, so the edge won't appear. However totalLifted is still 0
      // because the intra-folder `continue` comes *after* the highway check but
      // *after* wasRemapped. Let me re-read the code flow:
      //   1. mappedSource/mappedTarget computed
      //   2. highway segment check (skips remapped entry/exit)
      //   3. if mappedSource === mappedTarget -> continue (drops intra-folder)
      //   4. wasRemapped -> totalLifted++
      // So step 3 happens BEFORE step 4 — intra-folder edges don't count as lifted.
      expect(meta?.liftedEdgeCount).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty node and edge arrays', () => {
      const collapsed = new Set(['nonexistent']);

      const result = collapseFolders([], [], collapsed);

      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('handles collapsing multiple folders simultaneously', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('folder-b', 'group'),
        makeNode('m2', 'module', 'folder-b'),
        makeNode('m3', 'module'),
      ];
      const edges = [
        makeEdge('e1', 'm1', 'm3', 'import'),
        makeEdge('e2', 'm2', 'm3', 'dependency'),
        makeEdge('e3', 'm1', 'm2', 'import'),
      ];
      const collapsed = new Set(['folder-a', 'folder-b']);

      const result = collapseFolders(nodes, edges, collapsed);
      const nodeIds = result.nodes.map((n) => n.id);

      // m1 and m2 should be hidden
      expect(nodeIds).toContain('folder-a');
      expect(nodeIds).toContain('folder-b');
      expect(nodeIds).toContain('m3');
      expect(nodeIds).not.toContain('m1');
      expect(nodeIds).not.toContain('m2');

      // e1: m1->m3 becomes folder-a->m3
      // e2: m2->m3 becomes folder-b->m3
      // e3: m1->m2 becomes folder-a->folder-b
      expect(result.edges).toHaveLength(3);
    });

    it('handles a folder with a single child', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
      ];
      const edges: GraphEdge[] = [];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]?.id).toBe('folder-a');
      expect(result.collapsedMeta.get('folder-a')?.childIds).toEqual(['m1']);
    });

    it('handles a collapsed folder with no children', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
      ];
      const edges: GraphEdge[] = [];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);

      expect(result.nodes).toHaveLength(1);
      expect(result.collapsedMeta.get('folder-a')?.childIds).toEqual([]);
      expect(result.collapsedMeta.get('folder-a')?.liftedEdgeCount).toBe(0);
    });

    it('handles deeply nested collapse (outer collapsed hides inner group and its children)', () => {
      const nodes = [
        makeNode('outer', 'group'),
        makeNode('inner', 'group', 'outer'),
        makeNode('m1', 'module', 'inner'),
        makeNode('m2', 'module'),
      ];
      const edges = [makeEdge('e1', 'm1', 'm2', 'import')];
      const collapsed = new Set(['outer']);

      const result = collapseFolders(nodes, edges, collapsed);
      const nodeIds = result.nodes.map((n) => n.id);

      // inner and m1 are hidden inside outer
      expect(nodeIds).toContain('outer');
      expect(nodeIds).toContain('m2');
      expect(nodeIds).not.toContain('inner');
      expect(nodeIds).not.toContain('m1');

      // e1 rewired from m1->m2 to outer->m2
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]?.source).toBe('outer');
      expect(result.edges[0]?.target).toBe('m2');
    });

    it('uses default edge type when edge has no data.type', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module'),
      ];
      const edges: GraphEdge[] = [{
        id: 'e1',
        source: 'm1',
        target: 'm2',
        data: {},
      } as GraphEdge];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);

      // The edge should still be produced (default type is 'dependency')
      expect(result.edges).toHaveLength(1);
      // The key uses the default 'dependency' type
      expect(result.edges[0]?.id).toContain('dependency');
    });

    it('adds markerEnd to rewired edges that lack one', () => {
      const nodes = [
        makeNode('folder-a', 'group'),
        makeNode('m1', 'module', 'folder-a'),
        makeNode('m2', 'module'),
      ];
      const edges: GraphEdge[] = [{
        id: 'e1',
        source: 'm1',
        target: 'm2',
        data: { type: 'import' },
      } as GraphEdge];
      const collapsed = new Set(['folder-a']);

      const result = collapseFolders(nodes, edges, collapsed);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]?.markerEnd).toBeDefined();
    });
  });
});
