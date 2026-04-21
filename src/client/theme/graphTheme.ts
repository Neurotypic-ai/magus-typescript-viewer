import type { DependencyEdgeKind } from '../../shared/types/graph/DependencyEdgeKind';
import type { DependencyKind } from '../../shared/types/graph/DependencyKind';

import {
  ALL_DEPENDENCY_EDGE_KINDS,
  ALL_DEPENDENCY_KINDS,
  cssVar,
  graphCssVariableNames,
  graphTokenValues,
} from './graphTokens';

type CSSProperties = Record<string, string | number | undefined>;

interface NodePadding {
  content: number;
  header: number;
}

interface ThemeNodeDimensions {
  width: number;
  height: number;
}

interface NodeKindTheme {
  backgroundColor: string;
  borderColor: string;
  minWidth: string | number;
  padding: string;
  borderRadius: number;
  borderStyle?: string;
  minimapColor: string;
}

interface NodeHighlightTheme {
  borderWidth: {
    default: number;
    selected: number;
  };
}

interface NodeMinimapTheme {
  defaultColor: string;
  defaultStrokeColor: string;
  selectedStrokeColor: string;
}

interface NodeTheme {
  padding: NodePadding;
  borderColor: string;
  backgroundColor: string;
  borderRadius: number;
  minDimensions: ThemeNodeDimensions;
  kinds: Record<DependencyKind, NodeKindTheme>;
  highlight: NodeHighlightTheme;
  minimap: NodeMinimapTheme;
}

interface EdgeWidthSizes {
  default: number;
  selected: number;
  contains: number;
  extends: number;
  uses: number;
  highlighted: number;
  hover: number;
  isolated: number;
}

interface EdgeLabelSizes {
  fontSize: string;
}

interface EdgeSizes {
  width: EdgeWidthSizes;
  label: EdgeLabelSizes;
}

type EdgeColors = Record<DependencyEdgeKind, string>;

interface EdgeTheme {
  sizes: EdgeSizes;
  colors: EdgeColors;
}

interface IssueSeverityTheme {
  color: string;
  borderColor: string;
  glowColor?: string;
}

interface InsightSeverityTheme {
  backgroundColor: string;
  color: string;
}

interface SeverityTheme {
  issue: {
    error: IssueSeverityTheme;
    warning: IssueSeverityTheme;
    info: IssueSeverityTheme;
  };
  insight: {
    critical: InsightSeverityTheme;
    warning: InsightSeverityTheme;
    info: InsightSeverityTheme;
  };
}

interface GeometryTheme {
  handleSize: number;
  edgeMarkerWidth: number;
  edgeMarkerHeight: number;
}

interface LayoutSpacing {
  horizontal: number;
  vertical: number;
  edge: number;
  margin: number;
}

interface LayoutTheme {
  spacing: LayoutSpacing;
}

interface GraphTheme {
  nodes: NodeTheme;
  edges: EdgeTheme;
  severity: SeverityTheme;
  geometry: GeometryTheme;
  layout: LayoutTheme;
}

function createNodeKindTheme(type: DependencyKind): NodeKindTheme {
  const token = graphTokenValues.nodes.kinds[type] as {
    background: string;
    border: string;
    minWidth: string | number;
    padding: string;
    borderRadius: number;
    minimapColor: string;
    borderStyle?: string;
  };
  const cssVariables = graphCssVariableNames.nodeKinds[type];
  return {
    backgroundColor: cssVar(cssVariables.background),
    borderColor: cssVar(cssVariables.border),
    minWidth: token.minWidth,
    padding: token.padding,
    borderRadius: token.borderRadius,
    ...(token.borderStyle ? { borderStyle: token.borderStyle } : {}),
    minimapColor: token.minimapColor,
  };
}

const nodeKinds = Object.fromEntries(ALL_DEPENDENCY_KINDS.map((type) => [type, createNodeKindTheme(type)])) as Record<
  DependencyKind,
  NodeKindTheme
>;

const edgeColors = Object.fromEntries(
  ALL_DEPENDENCY_EDGE_KINDS.map((type) => [type, cssVar(graphCssVariableNames.edgeKinds[type].color)])
) as EdgeColors;

const rawEdgeWidths: {
  default: number;
  selected: number;
  contains: number;
  extends: number;
  uses: number;
  highlighted: number;
  hover: number;
  isolated: number;
} = graphTokenValues.edges.widths;

const edgeWidths: EdgeWidthSizes = {
  default: rawEdgeWidths.default,
  selected: rawEdgeWidths.selected,
  contains: rawEdgeWidths.contains,
  extends: rawEdgeWidths.extends,
  uses: rawEdgeWidths.uses,
  highlighted: rawEdgeWidths.highlighted,
  hover: rawEdgeWidths.hover,
  isolated: rawEdgeWidths.isolated,
};

export const graphTheme: GraphTheme = {
  nodes: {
    padding: graphTokenValues.nodes.padding,
    borderColor: cssVar(graphCssVariableNames.nodeBase.border),
    backgroundColor: cssVar(graphCssVariableNames.nodeBase.background),
    borderRadius: graphTokenValues.nodes.borderRadius,
    minDimensions: graphTokenValues.nodes.minDimensions,
    kinds: nodeKinds,
    highlight: {
      borderWidth: {
        default: graphTokenValues.nodes.highlight.defaultBorderWidth,
        selected: graphTokenValues.nodes.highlight.selectedBorderWidth,
      },
    },
    minimap: graphTokenValues.nodes.minimap,
  },
  edges: {
    sizes: {
      width: edgeWidths,
      label: {
        fontSize: graphTokenValues.edges.labelFontSize,
      },
    },
    colors: edgeColors,
  },
  severity: {
    issue: graphTokenValues.severity.issue,
    insight: graphTokenValues.severity.insight,
  },
  geometry: graphTokenValues.geometry,
  layout: {
    // These values intentionally mirror the current layout engine constants.
    // The layout engine is not wired to this object yet.
    spacing: {
      horizontal: 40,
      vertical: 60,
      edge: 20,
      margin: 30,
    },
  },
};

export function getNodeStyle(type: DependencyKind): CSSProperties {
  const kindTheme = graphTheme.nodes.kinds[type];
  const baseStyle: CSSProperties = {
    padding: `${String(graphTheme.nodes.padding.header)}px ${String(graphTheme.nodes.padding.content)}px`,
    borderRadius: graphTheme.nodes.borderRadius,
    border: `1px solid ${graphTheme.nodes.borderColor}`,
    backgroundColor: graphTheme.nodes.backgroundColor,
    minWidth: graphTheme.nodes.minDimensions.width,
    minHeight: graphTheme.nodes.minDimensions.height,
  };

  return {
    ...baseStyle,
    backgroundColor: kindTheme.backgroundColor,
    borderColor: kindTheme.borderColor,
    borderRadius: kindTheme.borderRadius,
    minWidth: kindTheme.minWidth,
    padding: kindTheme.padding,
    ...(kindTheme.borderStyle ? { borderStyle: kindTheme.borderStyle } : {}),
  };
}

export function getEdgeStyle(type: DependencyEdgeKind): CSSProperties {
  const baseStyle: CSSProperties = {
    stroke: edgeColors[type],
    strokeWidth: graphTheme.edges.sizes.width.default,
  };

  switch (type) {
    case 'implements':
    case 'extends':
      return {
        ...baseStyle,
        stroke: edgeColors[type],
        strokeWidth: graphTheme.edges.sizes.width.extends,
      };
    case 'contains':
      return {
        ...baseStyle,
        stroke: edgeColors[type],
        strokeWidth: graphTheme.edges.sizes.width.contains,
      };
    case 'uses':
      return {
        ...baseStyle,
        stroke: edgeColors[type],
        strokeWidth: graphTheme.edges.sizes.width.uses,
      };
    case 'dependency':
    case 'devDependency':
    case 'peerDependency':
    case 'import':
    case 'export':
      return {
        ...baseStyle,
        stroke: edgeColors[type],
      };
  }
}

export function getEdgeColor(type: DependencyEdgeKind): string {
  return edgeColors[type];
}
