import { describe, expect, it } from 'vitest';

import { cssVar, graphCssVariableNames } from '../graphTokens';
import { getEdgeColor, getEdgeStyle, getNodeStyle, graphTheme } from '../graphTheme';

import type { DependencyEdgeKind } from '../../../shared/types/graph/DependencyEdgeKind';
import type { DependencyKind } from '../../../shared/types/graph/DependencyKind';

const DEPENDENCY_KINDS: DependencyKind[] = [
  'package',
  'module',
  'class',
  'interface',
  'enum',
  'type',
  'function',
  'group',
  'property',
  'method',
];

const EDGE_KINDS: DependencyEdgeKind[] = [
  'dependency',
  'devDependency',
  'peerDependency',
  'import',
  'export',
  'implements',
  'extends',
  'contains',
  'uses',
  'fanInTrunk',
  'fanInStub',
];

describe('graphTheme contract', () => {
  it('defines explicit node theme entries for every dependency kind', () => {
    expect(Object.keys(graphTheme.nodes.kinds).sort()).toEqual([...DEPENDENCY_KINDS].sort());
  });

  it('backs package node surfaces with CSS variables', () => {
    expect(getNodeStyle('package')).toMatchObject({
      backgroundColor: cssVar(graphCssVariableNames.nodeKinds.package.background),
      borderColor: cssVar(graphCssVariableNames.nodeKinds.package.border),
      minWidth: graphTheme.nodes.kinds.package.minWidth,
      padding: graphTheme.nodes.kinds.package.padding,
      borderRadius: graphTheme.nodes.kinds.package.borderRadius,
    });
  });

  it('keeps group nodes explicitly themed instead of relying on the default branch', () => {
    expect(getNodeStyle('group')).toMatchObject({
      backgroundColor: cssVar(graphCssVariableNames.nodeKinds.group.background),
      borderColor: cssVar(graphCssVariableNames.nodeKinds.group.border),
      borderStyle: graphTheme.nodes.kinds.group.borderStyle,
    });
  });

  it('defines explicit edge colors for every dependency edge kind', () => {
    expect(Object.keys(graphTheme.edges.colors).sort()).toEqual([...EDGE_KINDS].sort());
  });

  it('returns explicit colors for contains, extends, and uses edges', () => {
    expect(getEdgeColor('contains')).toBe(cssVar(graphCssVariableNames.edgeKinds.contains.color));
    expect(getEdgeColor('extends')).toBe(cssVar(graphCssVariableNames.edgeKinds.extends.color));
    expect(getEdgeColor('uses')).toBe(cssVar(graphCssVariableNames.edgeKinds.uses.color));
  });

  it('returns explicit styles for extends and uses edges', () => {
    expect(getEdgeStyle('extends')).toMatchObject({
      stroke: cssVar(graphCssVariableNames.edgeKinds.extends.color),
      strokeWidth: graphTheme.edges.sizes.width.extends,
    });
    expect(getEdgeStyle('uses')).toMatchObject({
      stroke: cssVar(graphCssVariableNames.edgeKinds.uses.color),
      strokeWidth: graphTheme.edges.sizes.width.uses,
    });
  });

  it('keeps node highlight widths separate from edge stroke widths', () => {
    expect(graphTheme.nodes.highlight.borderWidth.default).toBe(1);
    expect(graphTheme.nodes.highlight.borderWidth.selected).toBe(2);
    expect(graphTheme.edges.sizes.width.default).toBe(1.5);
    expect(graphTheme.edges.sizes.width.selected).toBe(2.5);
  });

  it('captures the special interaction edge widths used across the graph UI', () => {
    expect(graphTheme.edges.sizes.width.highlighted).toBe(3);
    expect(graphTheme.edges.sizes.width.hover).toBe(2.8);
    expect(graphTheme.edges.sizes.width.isolated).toBe(2);
  });

  it('freezes the shared geometry contract at 12px markers and handles', () => {
    expect(graphTheme.geometry.handleSize).toBe(12);
    expect(graphTheme.geometry.edgeMarkerWidth).toBe(12);
    expect(graphTheme.geometry.edgeMarkerHeight).toBe(12);
  });
});
