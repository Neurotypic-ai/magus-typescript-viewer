import type { DependencyEdgeKind, DependencyKind } from '../types';

type CSSProperties = Record<string, string | number | undefined>;

// Node-related type definitions
export interface NodePadding {
  content: number;
  header: number;
}

export interface NodeBackgroundColors {
  default: string;
  package: string;
}

export interface NodeColors {
  background: NodeBackgroundColors;
  border: string;
}

export interface ThemeNodeDimensions {
  width: number;
  height: number;
}

export interface NodeTheme {
  padding: NodePadding;
  colors: NodeColors;
  borderRadius: number;
  minDimensions: ThemeNodeDimensions;
}

// Edge-related type definitions
export interface EdgeWidthSizes {
  default: number;
  selected: number;
  inheritance: number;
}

export interface EdgeLabelSizes {
  fontSize: string;
}

export interface EdgeSizes {
  width: EdgeWidthSizes;
  label: EdgeLabelSizes;
}

export interface EdgeColors {
  import: string;
  export: string;
  inheritance: string;
  implements: string;
  dependency: string;
  devDependency: string;
  peerDependency: string;
  contains: string;
  default: string;
}

export interface EdgeTheme {
  sizes: EdgeSizes;
  colors: EdgeColors;
}

// Layout-related type definitions
export interface LayoutSpacing {
  horizontal: number;
  vertical: number;
  edge: number;
  margin: number;
}

export interface LayoutTheme {
  spacing: LayoutSpacing;
}

// Main theme interface
export interface GraphTheme {
  nodes: NodeTheme;
  edges: EdgeTheme;
  layout: LayoutTheme;
}

// Theme configuration
export const graphTheme: GraphTheme = {
  nodes: {
    padding: {
      content: 16,
      header: 8,
    },
    colors: {
      background: {
        default: '#1a1a1a',
        package: '#2d2d2d',
      },
      border: '#404040',
    },
    borderRadius: 4,
    minDimensions: {
      width: 100,
      height: 30,
    },
  },
  edges: {
    sizes: {
      width: {
        default: 1,
        selected: 2,
        inheritance: 2,
      },
      label: {
        fontSize: '12px',
      },
    },
    colors: {
      import: '#61dafb',
      export: '#ffd700',
      inheritance: '#4caf50',
      implements: '#ff9800',
      dependency: '#f44336',
      devDependency: '#795548',
      peerDependency: '#009688',
      contains: '#9c27b0',
      default: '#404040',
    },
  },
  layout: {
    spacing: {
      horizontal: 50, // Base spacing between nodes
      vertical: 80, // Base spacing between ranks
      edge: 20, // Base spacing between edges
      margin: 30, // Base margin around the graph
    },
  },
};

// Create a type-safe theme instance for use in helper functions
const defaultTheme = graphTheme as Required<GraphTheme>;

// Node Styles
export function getNodeStyle(type: DependencyKind): CSSProperties {
  const baseStyle: CSSProperties = {
    padding: `${String(defaultTheme.nodes.padding.header)}px ${String(defaultTheme.nodes.padding.content)}px`,
    borderRadius: defaultTheme.nodes.borderRadius,
    border: `1px solid ${defaultTheme.nodes.colors.border}`,
    backgroundColor: defaultTheme.nodes.colors.background.default,
    minWidth: defaultTheme.nodes.minDimensions.width,
    minHeight: defaultTheme.nodes.minDimensions.height,
  };

  switch (type) {
    case 'package':
      return {
        ...baseStyle,
        backgroundColor: 'rgba(20, 184, 166, 0.08)',
        borderColor: 'rgba(20, 184, 166, 0.3)',
        borderRadius: defaultTheme.nodes.borderRadius * 2,
        minWidth: '200px',
        padding: '20px',
      };
    case 'module':
      return {
        ...baseStyle,
        backgroundColor: 'rgba(59, 130, 246, 0.06)',
        borderColor: 'rgba(59, 130, 246, 0.25)',
        minWidth: '180px',
        padding: '16px',
      };
    case 'class':
      return {
        ...baseStyle,
        backgroundColor: 'rgba(59, 130, 246, 0.10)',
        borderColor: 'rgba(59, 130, 246, 0.35)',
        minWidth: '200px',
        padding: '12px',
      };
    case 'interface':
      return {
        ...baseStyle,
        backgroundColor: 'rgba(168, 85, 247, 0.10)',
        borderColor: 'rgba(168, 85, 247, 0.35)',
        minWidth: '200px',
        padding: '12px',
      };
    case 'group':
      return {
        ...baseStyle,
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        borderStyle: 'dashed',
        borderColor: 'rgba(255, 255, 255, 0.15)',
        minWidth: '180px',
        padding: '8px',
      };
    case 'property':
      return {
        ...baseStyle,
        backgroundColor: 'rgba(100, 149, 237, 0.15)',
        borderColor: 'rgba(100, 149, 237, 0.4)',
        minWidth: '180px',
        padding: '6px 10px',
      };
    case 'method':
      return {
        ...baseStyle,
        backgroundColor: 'rgba(186, 85, 211, 0.15)',
        borderColor: 'rgba(186, 85, 211, 0.4)',
        minWidth: '180px',
        padding: '6px 10px',
      };
    default:
      return baseStyle;
  }
}

// Edge Styles
export function getEdgeStyle(type: DependencyEdgeKind): CSSProperties {
  const baseStyle: CSSProperties = {
    stroke: defaultTheme.edges.colors.default,
    strokeWidth: defaultTheme.edges.sizes.width.default,
  };

  switch (type) {
    case 'inheritance':
      return {
        ...baseStyle,
        stroke: defaultTheme.edges.colors.inheritance,
        strokeWidth: defaultTheme.edges.sizes.width.inheritance,
      };
    case 'implements':
      return {
        ...baseStyle,
        stroke: defaultTheme.edges.colors.implements,
      };
    case 'import':
      return {
        ...baseStyle,
        stroke: defaultTheme.edges.colors.import,
      };
    case 'export':
      return {
        ...baseStyle,
        stroke: defaultTheme.edges.colors.export,
      };
    case 'dependency':
      return {
        ...baseStyle,
        stroke: defaultTheme.edges.colors.dependency,
      };
    case 'devDependency':
      return {
        ...baseStyle,
        stroke: defaultTheme.edges.colors.devDependency,
      };
    case 'peerDependency':
      return {
        ...baseStyle,
        stroke: defaultTheme.edges.colors.peerDependency,
      };
    case 'contains':
      return {
        ...baseStyle,
        stroke: defaultTheme.edges.colors.contains,
        strokeWidth: 1.5,
      };
    default:
      return baseStyle;
  }
}

// Edge Color Helper
export function getEdgeColor(type: DependencyEdgeKind): string {
  switch (type) {
    case 'inheritance':
      return defaultTheme.edges.colors.inheritance;
    case 'implements':
      return defaultTheme.edges.colors.implements;
    case 'import':
      return defaultTheme.edges.colors.import;
    case 'export':
      return defaultTheme.edges.colors.export;
    case 'dependency':
      return defaultTheme.edges.colors.dependency;
    case 'devDependency':
      return defaultTheme.edges.colors.devDependency;
    case 'peerDependency':
      return defaultTheme.edges.colors.peerDependency;
    default:
      return defaultTheme.edges.colors.default;
  }
}
