import type { DependencyEdgeKind } from '../../shared/types/graph/DependencyEdgeKind';
import type { DependencyKind } from '../../shared/types/graph/DependencyKind';

type GraphCssVariableName = `--${string}`;

export const ALL_DEPENDENCY_KINDS: DependencyKind[] = [
  'package',
  'module',
  'externalPackage',
  'class',
  'interface',
  'enum',
  'type',
  'function',
  'group',
  'property',
  'method',
];

export const ALL_DEPENDENCY_EDGE_KINDS: DependencyEdgeKind[] = [
  'dependency',
  'devDependency',
  'peerDependency',
  'import',
  'export',
  'inheritance',
  'implements',
  'extends',
  'contains',
  'uses',
];

export const graphCssVariableNames = {
  nodeBase: {
    background: '--background-node',
    border: '--border-default',
  },
  nodeKinds: {
    package: {
      background: '--graph-node-package-bg',
      border: '--graph-node-package-border',
    },
    module: {
      background: '--graph-node-module-bg',
      border: '--graph-node-module-border',
    },
    externalPackage: {
      background: '--graph-node-external-package-bg',
      border: '--graph-node-external-package-border',
    },
    class: {
      background: '--graph-node-class-bg',
      border: '--graph-node-class-border',
    },
    interface: {
      background: '--graph-node-interface-bg',
      border: '--graph-node-interface-border',
    },
    enum: {
      background: '--graph-node-default-bg',
      border: '--graph-node-default-border',
    },
    type: {
      background: '--graph-node-default-bg',
      border: '--graph-node-default-border',
    },
    function: {
      background: '--graph-node-default-bg',
      border: '--graph-node-default-border',
    },
    group: {
      background: '--graph-node-group-bg',
      border: '--graph-node-group-border',
    },
    property: {
      background: '--graph-node-property-bg',
      border: '--graph-node-property-border',
    },
    method: {
      background: '--graph-node-method-bg',
      border: '--graph-node-method-border',
    },
  },
  edgeKinds: {
    default: {
      color: '--graph-edge-default',
    },
    dependency: {
      color: '--graph-edge-dependency',
    },
    devDependency: {
      color: '--graph-edge-dev-dependency',
    },
    peerDependency: {
      color: '--graph-edge-peer-dependency',
    },
    import: {
      color: '--graph-edge-import',
    },
    export: {
      color: '--graph-edge-export',
    },
    inheritance: {
      color: '--graph-edge-inheritance',
    },
    implements: {
      color: '--graph-edge-implements',
    },
    extends: {
      color: '--graph-edge-extends',
    },
    contains: {
      color: '--graph-edge-contains',
    },
    uses: {
      color: '--graph-edge-uses',
    },
  },
  nodeBadges: {
    module: {
      background: '--graph-badge-module-bg',
      color: '--graph-badge-module-text',
    },
    class: {
      background: '--graph-badge-class-bg',
      color: '--graph-badge-class-text',
    },
    interface: {
      background: '--graph-badge-interface-bg',
      color: '--graph-badge-interface-text',
    },
    property: {
      background: '--graph-badge-property-bg',
      color: '--graph-badge-property-text',
    },
    method: {
      background: '--graph-badge-method-bg',
      color: '--graph-badge-method-text',
    },
    default: {
      background: '--graph-badge-default-bg',
      color: '--text-secondary',
    },
  },
  issueSeverity: {
    error: {
      color: '--graph-issue-error',
      border: '--graph-issue-error-border',
      glow: '--graph-issue-error-glow',
    },
    warning: {
      color: '--graph-issue-warning',
      border: '--graph-issue-warning-border',
      glow: '--graph-issue-warning-glow',
    },
    info: {
      color: '--graph-issue-info',
      border: '--graph-issue-info-border',
    },
  },
  insightSeverity: {
    critical: {
      background: '--graph-insight-critical-bg',
      color: '--graph-insight-critical-text',
    },
    warning: {
      background: '--graph-insight-warning-bg',
      color: '--graph-insight-warning-text',
    },
    info: {
      background: '--graph-insight-info-bg',
      color: '--graph-insight-info-text',
    },
  },
  selection: {
    targetBorder: '--graph-selection-target-border',
    targetOutline: '--graph-selection-target-outline',
    connectedBorder: '--graph-selection-connected-border',
    connectedOutline: '--graph-selection-connected-outline',
    hoverPulse: '--graph-selection-hover-pulse',
    fpsLine: '--graph-fps-line',
    fpsGood: '--graph-fps-good',
    fpsOk: '--graph-fps-ok',
    fpsLow: '--graph-fps-low',
  },
  geometry: {
    handleSize: '--graph-handle-size',
    edgeMarkerWidth: '--graph-edge-marker-width',
    edgeMarkerHeight: '--graph-edge-marker-height',
    edgeWidth: '--graph-edge-width',
    edgeWidthSelected: '--graph-edge-width-selected',
    edgeWidthInheritance: '--graph-edge-width-inheritance',
    edgeWidthContains: '--graph-edge-width-contains',
    edgeWidthExtends: '--graph-edge-width-extends',
    edgeWidthUses: '--graph-edge-width-uses',
    edgeLabelFontSize: '--graph-edge-label-font-size',
  },
} as const;

export const cssVar = (name: GraphCssVariableName): string => `var(${name})`;

export const graphTokenValues = {
  nodes: {
    padding: {
      content: 16,
      header: 8,
    },
    borderRadius: 4,
    minDimensions: {
      width: 100,
      height: 30,
    },
    highlight: {
      defaultBorderWidth: 1,
      selectedBorderWidth: 2,
    },
    kinds: {
      package: {
        background: 'rgba(20, 184, 166, 0.08)',
        border: 'rgba(20, 184, 166, 0.3)',
        minWidth: '200px',
        padding: '20px',
        borderRadius: 8,
        minimapColor: 'rgba(20, 184, 166, 0.8)',
      },
      module: {
        background: 'rgba(59, 130, 246, 0.06)',
        border: 'rgba(59, 130, 246, 0.25)',
        minWidth: '180px',
        padding: '16px',
        borderRadius: 4,
        minimapColor: 'rgba(59, 130, 246, 0.75)',
      },
      externalPackage: {
        background: 'rgba(245, 158, 11, 0.08)',
        border: 'rgba(245, 158, 11, 0.4)',
        minWidth: '140px',
        padding: '10px 14px',
        borderRadius: 4,
        minimapColor: 'rgba(245, 158, 11, 0.7)',
      },
      class: {
        background: 'rgba(59, 130, 246, 0.10)',
        border: 'rgba(59, 130, 246, 0.35)',
        minWidth: '200px',
        padding: '12px',
        borderRadius: 4,
        minimapColor: 'rgba(217, 119, 6, 0.7)',
      },
      interface: {
        background: 'rgba(168, 85, 247, 0.10)',
        border: 'rgba(168, 85, 247, 0.35)',
        minWidth: '200px',
        padding: '12px',
        borderRadius: 4,
        minimapColor: 'rgba(217, 119, 6, 0.7)',
      },
      enum: {
        background: '#1a1a1a',
        border: '#404040',
        minWidth: 100,
        padding: '8px 16px',
        borderRadius: 4,
        minimapColor: 'rgba(148, 163, 184, 0.6)',
      },
      type: {
        background: '#1a1a1a',
        border: '#404040',
        minWidth: 100,
        padding: '8px 16px',
        borderRadius: 4,
        minimapColor: 'rgba(148, 163, 184, 0.6)',
      },
      function: {
        background: '#1a1a1a',
        border: '#404040',
        minWidth: 100,
        padding: '8px 16px',
        borderRadius: 4,
        minimapColor: 'rgba(148, 163, 184, 0.6)',
      },
      group: {
        background: 'rgba(255, 255, 255, 0.02)',
        border: 'rgba(255, 255, 255, 0.15)',
        minWidth: '180px',
        padding: '8px',
        borderRadius: 4,
        borderStyle: 'dashed',
        minimapColor: 'rgba(148, 163, 184, 0.6)',
      },
      property: {
        background: 'rgba(100, 149, 237, 0.15)',
        border: 'rgba(100, 149, 237, 0.4)',
        minWidth: '180px',
        padding: '6px 10px',
        borderRadius: 4,
        minimapColor: 'rgba(148, 163, 184, 0.6)',
      },
      method: {
        background: 'rgba(186, 85, 211, 0.15)',
        border: 'rgba(186, 85, 211, 0.4)',
        minWidth: '180px',
        padding: '6px 10px',
        borderRadius: 4,
        minimapColor: 'rgba(148, 163, 184, 0.6)',
      },
    },
    minimap: {
      defaultColor: 'rgba(148, 163, 184, 0.6)',
      defaultStrokeColor: 'rgba(226, 232, 240, 0.8)',
      selectedStrokeColor: '#22d3ee',
    },
  },
  edges: {
    colors: {
      dependency: '#f44336',
      devDependency: '#bcaaa4',
      peerDependency: '#4db6ac',
      import: '#61dafb',
      export: '#ffd700',
      inheritance: '#4caf50',
      implements: '#ff9800',
      extends: '#66bb6a',
      contains: '#ce93d8',
      uses: '#9e9e9e',
    } as Record<DependencyEdgeKind, string>,
    widths: {
      default: 1.5,
      selected: 2.5,
      inheritance: 1.5,
      contains: 1.5,
      extends: 1.5,
      uses: 1.5,
      highlighted: 3,
      hover: 2.8,
      isolated: 2,
    },
    labelFontSize: '10px',
  },
  severity: {
    issue: {
      error: {
        color: '#ef4444',
        borderColor: 'rgba(239, 68, 68, 0.5)',
        glowColor: 'rgba(239, 68, 68, 0.35)',
      },
      warning: {
        color: '#fbbf24',
        borderColor: 'rgba(251, 191, 36, 0.5)',
        glowColor: 'rgba(251, 191, 36, 0.28)',
      },
      info: {
        color: '#60a5fa',
        borderColor: 'rgba(96, 165, 250, 0.5)',
      },
    },
    insight: {
      critical: {
        backgroundColor: 'rgba(239, 68, 68, 0.18)',
        color: '#f87171',
      },
      warning: {
        backgroundColor: 'rgba(251, 191, 36, 0.18)',
        color: '#fbbf24',
      },
      info: {
        backgroundColor: 'rgba(96, 165, 250, 0.12)',
        color: '#93c5fd',
      },
    },
  },
  badges: {
    module: {
      backgroundColor: 'rgba(20, 184, 166, 0.2)',
      color: 'rgb(94, 234, 212)',
    },
    class: {
      backgroundColor: 'rgba(59, 130, 246, 0.2)',
      color: 'rgb(147, 197, 253)',
    },
    interface: {
      backgroundColor: 'rgba(168, 85, 247, 0.2)',
      color: 'rgb(216, 180, 254)',
    },
    property: {
      backgroundColor: 'rgba(20, 184, 166, 0.2)',
      color: 'rgb(94, 234, 212)',
    },
    method: {
      backgroundColor: 'rgba(249, 115, 22, 0.2)',
      color: 'rgb(253, 186, 116)',
    },
    default: {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
  },
  selection: {
    targetBorder: '#22d3ee',
    targetOutline: 'rgba(34, 211, 238, 0.34)',
    connectedBorder: 'rgba(34, 211, 238, 0.5)',
    connectedOutline: 'rgba(34, 211, 238, 0.26)',
    hoverPulse: '#facc15',
    fpsLine: '#22d3ee',
    fpsGood: '#4ade80',
    fpsOk: '#fbbf24',
    fpsLow: '#f87171',
  },
  geometry: {
    handleSize: 12,
    edgeMarkerWidth: 12,
    edgeMarkerHeight: 12,
  },
} as const;
