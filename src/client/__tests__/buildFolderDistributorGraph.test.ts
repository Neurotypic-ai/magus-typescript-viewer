import { describe, expect, it } from 'vitest';

import { buildFolderDistributorGraph } from '../graph/buildGraphView';

import type { DependencyPackageGraph } from '../types/DependencyPackageGraph';

function createFixtureGraph(): DependencyPackageGraph {
  return {
    packages: [
      {
        id: 'pkg-1',
        name: 'pkg',
        version: '1.0.0',
        path: '/pkg',
        created_at: '2024-01-01T00:00:00.000Z',
        modules: {
          a: {
            id: 'module-a',
            name: 'a.ts',
            package_id: 'pkg-1',
            source: { relativePath: 'src/a/a.ts' },
            imports: {
              i1: {
                uuid: 'i1',
                name: 'b',
                path: '../b/b',
              },
            },
          },
          b: {
            id: 'module-b',
            name: 'b.ts',
            package_id: 'pkg-1',
            source: { relativePath: 'src/b/b.ts' },
            imports: {},
          },
          test: {
            id: 'module-test',
            name: 'a.test.ts',
            package_id: 'pkg-1',
            source: { relativePath: 'src/a/a.test.ts' },
            imports: {},
          },
        },
      },
    ],
  };
}

function createOptions(overrides: Partial<Parameters<typeof buildFolderDistributorGraph>[0]> = {}) {
  return {
    data: createFixtureGraph(),
    enabledNodeTypes: ['module'],
    enabledRelationshipTypes: ['import'],
    direction: 'LR' as const,
    collapsedFolderIds: new Set<string>(),
    hideTestFiles: false,
    memberNodeMode: 'compact' as const,
    highlightOrphanGlobal: false,
    ...overrides,
  };
}

describe('buildFolderDistributorGraph', () => {
  it('always returns an empty rendered edge list', () => {
    const result = buildFolderDistributorGraph(createOptions());
    expect(result.edges).toEqual([]);
  });

  it('keeps semantic snapshot edges populated when imports exist', () => {
    const result = buildFolderDistributorGraph(createOptions());
    expect(result.semanticSnapshot?.edges.length).toBeGreaterThan(0);
  });

  it('creates folder group nodes', () => {
    const result = buildFolderDistributorGraph(createOptions());
    expect(result.nodes.some((node) => node.type === 'group')).toBe(true);
  });

  it('respects hideTestFiles filtering', () => {
    const result = buildFolderDistributorGraph(createOptions({ hideTestFiles: true }));
    expect(result.nodes.some((node) => node.id === 'module-test')).toBe(false);
    expect(result.semanticSnapshot?.nodes.some((node) => node.id === 'module-test')).toBe(false);
  });

  it('respects enabledNodeTypes filtering', () => {
    const result = buildFolderDistributorGraph(createOptions({ enabledNodeTypes: ['package'] }));
    expect(result.nodes.some((node) => node.type === 'module')).toBe(false);
    expect(result.nodes.some((node) => node.type === 'package')).toBe(true);
  });

  it('applies collapsedFolderIds by hiding children and flagging the group', () => {
    const collapsedFolderId = 'dir:pkg:src/a';
    const result = buildFolderDistributorGraph(
      createOptions({
        collapsedFolderIds: new Set<string>([collapsedFolderId]),
      })
    );

    const collapsedGroup = result.nodes.find((node) => node.id === collapsedFolderId);
    const collapsedGroupData = collapsedGroup?.data as { isCollapsed?: boolean } | undefined;
    expect(collapsedGroup).toBeDefined();
    expect(collapsedGroupData?.isCollapsed).toBe(true);
    expect(result.nodes.some((node) => node.id === 'module-a')).toBe(false);
  });

  it('computes orphan diagnostics from semantic edges even when rendered edges are empty', () => {
    const result = buildFolderDistributorGraph(createOptions());

    const moduleA = result.nodes.find((node) => node.id === 'module-a');
    const moduleB = result.nodes.find((node) => node.id === 'module-b');

    expect(result.edges).toEqual([]);
    expect(result.semanticSnapshot?.edges.length).toBeGreaterThan(0);
    expect(moduleA?.data?.diagnostics?.orphanCurrent).toBe(false);
    expect(moduleB?.data?.diagnostics?.orphanCurrent).toBe(false);
  });
});
