import { describe, expect, it } from 'vitest';

import { collapseFolders } from '../../cluster/collapseFolders';
import { GROUP_ENTRY_STUB_PX } from '../../../components/DependencyGraph/layout/edgeGeometryPolicy';
import { applyEdgeHighways, optimizeHighwayHandleRouting } from '../edgeHighways';

import type { DependencyEdgeKind, DependencyNode, GraphEdge } from '../../../components/DependencyGraph/types';

const makeGroup = (id: string): DependencyNode =>
  ({
    id,
    type: 'group',
    position: { x: 0, y: 0 },
    data: { label: id },
  }) as DependencyNode;

const makeModule = (id: string, parentNode: string): DependencyNode =>
  ({
    id,
    type: 'module',
    parentNode,
    position: { x: 0, y: 0 },
    data: { label: id },
  }) as DependencyNode;

const makeEdge = (id: string, source: string, target: string, type: DependencyEdgeKind): GraphEdge =>
  ({
    id,
    source,
    target,
    hidden: false,
    data: { type },
  }) as GraphEdge;

const getHandleSide = (handleId: string | null | undefined): string | undefined => {
  if (!handleId) return undefined;
  const folderMatch = handleId.match(/folder-(top|right|bottom|left)-(?:in|out)(?:-inner)?$/);
  if (folderMatch) {
    return folderMatch[1];
  }
  const relationalMatch = handleId.match(/relational-(?:in|out)-(top|right|bottom|left)$/);
  return relationalMatch?.[1];
};

describe('applyEdgeHighways', () => {
  it('projects cross-folder edges into exit, trunk, and entry segments', () => {
    const nodes: DependencyNode[] = [
      makeGroup('folder:A'),
      makeGroup('folder:B'),
      makeModule('module:A1', 'folder:A'),
      makeModule('module:B1', 'folder:B'),
    ];
    const edges: GraphEdge[] = [
      makeEdge('e-cross', 'module:A1', 'module:B1', 'import'),
      makeEdge('e-intra', 'module:A1', 'module:A1', 'uses'),
    ];

    const result = applyEdgeHighways(nodes, edges, { direction: 'LR' });
    const optimizedEdges = optimizeHighwayHandleRouting(nodes, result.edges);
    const segmentKinds = optimizedEdges.map((edge) => edge.data?.highwaySegment);

    expect(segmentKinds).toEqual(expect.arrayContaining(['exit', 'highway', 'entry']));
    expect(optimizedEdges.some((edge) => edge.id === 'e-intra')).toBe(true);

    const trunk = optimizedEdges.find((edge) => edge.data?.highwaySegment === 'highway');
    const exit = optimizedEdges.find((edge) => edge.data?.highwaySegment === 'exit');
    const entry = optimizedEdges.find((edge) => edge.data?.highwaySegment === 'entry');
    expect(trunk?.source).toBe('folder:A');
    expect(trunk?.target).toBe('folder:B');
    expect(trunk?.sourceHandle).toMatch(/^folder-(top|right|bottom|left)-out$/);
    expect(trunk?.targetHandle).toMatch(/^folder-(top|right|bottom|left)-in$/);
    expect(exit?.sourceHandle).toMatch(/^relational-out-(top|right|bottom|left)$/);
    expect(exit?.targetHandle).toMatch(/^folder-(top|right|bottom|left)-out-inner$/);
    expect(exit?.type).toBe('smoothstep');
    expect(exit?.pathOptions).toMatchObject({ offset: GROUP_ENTRY_STUB_PX, borderRadius: 0 });
    expect(getHandleSide(exit?.sourceHandle)).toBe(getHandleSide(exit?.targetHandle));
    expect(entry?.sourceHandle).toMatch(/^folder-(top|right|bottom|left)-in-inner$/);
    expect(entry?.targetHandle).toMatch(/^relational-in-(top|right|bottom|left)$/);
    expect(getHandleSide(entry?.sourceHandle)).toBe(getHandleSide(entry?.targetHandle));
    expect(entry?.type).toBe('smoothstep');
    expect(entry?.pathOptions).toMatchObject({ offset: GROUP_ENTRY_STUB_PX, borderRadius: 0 });
  });

  it('aggregates trunk counts and type breakdown per folder pair', () => {
    const nodes: DependencyNode[] = [
      makeGroup('folder:A'),
      makeGroup('folder:B'),
      makeModule('module:A1', 'folder:A'),
      makeModule('module:A2', 'folder:A'),
      makeModule('module:B1', 'folder:B'),
    ];
    const edges: GraphEdge[] = [
      makeEdge('e1', 'module:A1', 'module:B1', 'import'),
      makeEdge('e2', 'module:A2', 'module:B1', 'import'),
      makeEdge('e3', 'module:A2', 'module:B1', 'inheritance'),
    ];

    const result = applyEdgeHighways(nodes, edges, { direction: 'TB' });
    const trunks = result.edges.filter((edge) => edge.data?.highwaySegment === 'highway');
    expect(trunks).toHaveLength(1);

    const trunk = trunks[0]!;
    expect(trunk.data?.highwayCount).toBe(2);
    expect(trunk.data?.highwayTypeBreakdown?.import).toBe(2);
    expect(trunk.data?.highwayTypeBreakdown?.inheritance).toBeUndefined();
    expect(trunk.sourceHandle).toBe('folder-bottom-out');
    expect(trunk.targetHandle).toBe('folder-top-in');
  });

  it('resolves nested endpoints through parentNode chain', () => {
    const nodes: DependencyNode[] = [
      makeGroup('folder:A'),
      makeGroup('folder:B'),
      makeModule('module:A1', 'folder:A'),
      makeModule('module:B1', 'folder:B'),
      {
        id: 'class:A1',
        type: 'class',
        parentNode: 'module:A1',
        position: { x: 0, y: 0 },
        data: { label: 'class:A1' },
      } as DependencyNode,
      {
        id: 'class:B1',
        type: 'class',
        parentNode: 'module:B1',
        position: { x: 0, y: 0 },
        data: { label: 'class:B1' },
      } as DependencyNode,
    ];
    const edges: GraphEdge[] = [makeEdge('nested', 'class:A1', 'class:B1', 'inheritance')];

    const result = applyEdgeHighways(nodes, edges, { direction: 'LR' });
    const trunk = result.edges.find((edge) => edge.data?.highwaySegment === 'highway');
    expect(trunk).toBeDefined();
    expect(trunk?.source).toBe('folder:A');
    expect(trunk?.target).toBe('folder:B');
  });

  it('keeps trunk edges after collapsing folders', () => {
    const nodes: DependencyNode[] = [
      makeGroup('folder:A'),
      makeGroup('folder:B'),
      makeModule('module:A1', 'folder:A'),
      makeModule('module:B1', 'folder:B'),
    ];
    const edges: GraphEdge[] = [makeEdge('e-cross', 'module:A1', 'module:B1', 'import')];

    const highwayGraph = applyEdgeHighways(nodes, edges, { direction: 'LR' });
    const collapsed = collapseFolders(highwayGraph.nodes, highwayGraph.edges, new Set(['folder:A']));

    const trunk = collapsed.edges.find((edge) => edge.data?.highwaySegment === 'highway');
    expect(trunk).toBeDefined();
    expect(collapsed.edges.some((edge) => edge.data?.highwaySegment === 'exit')).toBe(false);
  });

  it('chooses nearest handles and allows multiple outgoing handles per module', () => {
    const nodes: DependencyNode[] = [
      {
        ...makeGroup('folder:A'),
        position: { x: 0, y: 0 },
        style: { width: 300, height: 300 },
      } as DependencyNode,
      {
        ...makeGroup('folder:B'),
        position: { x: 700, y: 40 },
        style: { width: 260, height: 220 },
      } as DependencyNode,
      {
        ...makeGroup('folder:C'),
        position: { x: 40, y: 760 },
        style: { width: 260, height: 220 },
      } as DependencyNode,
      {
        ...makeModule('module:A1', 'folder:A'),
        position: { x: 230, y: 210 },
      } as DependencyNode,
      {
        ...makeModule('module:B1', 'folder:B'),
        position: { x: 40, y: 80 },
      } as DependencyNode,
      {
        ...makeModule('module:C1', 'folder:C'),
        position: { x: 80, y: 70 },
      } as DependencyNode,
    ];

    const edges: GraphEdge[] = [
      makeEdge('a-to-b', 'module:A1', 'module:B1', 'import'),
      makeEdge('a-to-c', 'module:A1', 'module:C1', 'import'),
    ];

    const projected = applyEdgeHighways(nodes, edges, { direction: 'LR' });
    const optimized = optimizeHighwayHandleRouting(nodes, projected.edges);
    const exits = optimized.filter((edge) => edge.data?.highwaySegment === 'exit' && edge.source === 'module:A1');

    expect(exits).toHaveLength(2);
    expect(new Set(exits.map((edge) => edge.targetHandle))).toEqual(
      new Set(['folder-right-out-inner', 'folder-bottom-out-inner'])
    );
    expect(new Set(exits.map((edge) => edge.sourceHandle))).toEqual(
      new Set(['relational-out-right', 'relational-out-bottom'])
    );
    expect(exits.every((edge) => edge.type === 'smoothstep')).toBe(true);
  });

  it('does not force straight rendering for folder-to-descendant edges', () => {
    const nodes: DependencyNode[] = [
      {
        ...makeGroup('folder:A'),
        position: { x: 0, y: 0 },
        style: { width: 300, height: 300 },
      } as DependencyNode,
      {
        ...makeModule('module:A1', 'folder:A'),
        position: { x: 80, y: 80 },
      } as DependencyNode,
    ];

    const edges: GraphEdge[] = [
      {
        id: 'folder-child-direct',
        source: 'folder:A',
        target: 'module:A1',
        hidden: false,
        data: { type: 'import' },
      } as GraphEdge,
    ];

    const optimized = optimizeHighwayHandleRouting(nodes, edges);
    expect(optimized[0]?.type).not.toBe('straight');
  });
});

