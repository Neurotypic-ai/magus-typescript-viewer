/**
 * Web Worker for handling complex graph layout calculations
 * This offloads CPU-intensive operations from the main thread
 */

import type { Edge } from '@vue-flow/core';

import type { DependencyNode } from '../components/DependencyGraph/types';
import type { GraphTheme } from '../theme/graphTheme';

// Worker message types
interface WorkerMessage {
  type: 'process-layout';
  payload: {
    nodes: DependencyNode[];
    edges: Edge[];
    config: LayoutConfig;
  };
}

interface LayoutConfig {
  algorithm: 'layered' | 'radial' | 'force' | 'stress';
  direction: 'DOWN' | 'UP' | 'RIGHT' | 'LEFT';
  nodesep: number;
  edgesep: number;
  ranksep: number;
  degreeWeightedLayers?: boolean;
  theme: GraphTheme;
  animationDuration?: number;
}

let elkInstancePromise: Promise<{ layout: (graph: unknown) => Promise<any> }> | null = null;

async function getElkInstance(): Promise<{ layout: (graph: unknown) => Promise<any> }> {
  if (!elkInstancePromise) {
    elkInstancePromise = (async () => {
      const { default: ELK } = await import('elkjs/lib/elk-api.js');
      const workerUrl = new URL('elkjs/lib/elk-worker.min.js', import.meta.url).href;
      return new ELK({ workerUrl }) as { layout: (graph: unknown) => Promise<any> };
    })();
  }

  try {
    return await elkInstancePromise;
  } catch (error) {
    // Reset cache if initialization fails so a later request can retry.
    elkInstancePromise = null;
    throw error;
  }
}

// Handle messages from the main thread using ELK layered layout
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { nodes, edges, config } = event.data.payload;

  try {
    const elk = await getElkInstance();

    const defaultWidth = 200;
    const defaultHeight = 120;

    // Define ELK node type
    interface ElkNode {
      id: string;
      width: number;
      height: number;
      x?: number;
      y?: number;
      children?: ElkNode[];
      layoutOptions?: Record<string, string>;
    }

    /**
     * Parse a CSS size value (number or string like '280px') to a numeric pixel value.
     */
    function parseCssSize(val: unknown): number {
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const num = parseFloat(val);
        return isNaN(num) ? 0 : num;
      }
      return 0;
    }

    /**
     * Estimate text width in pixels based on character count and average char width.
     * Uses conservative estimates (monospace ~7.5px/char, proportional ~6.5px/char at ~11px font).
     */
    function estimateTextWidth(text: string, padding = 32): number {
      return Math.ceil(text.length * 7) + padding;
    }

    /**
     * Estimate the rendered size of a node based on its type, style hints, and data content.
     * On the first layout pass, nodes haven't been measured by the DOM yet, so ELK needs
     * realistic size estimates to avoid placing nodes too close together (causing overlaps).
     */
    // Layout buffer added to real DOM measurements so ELK reserves slightly
    // more space per node.  offsetWidth/offsetHeight capture the border-box but
    // not box-shadows, selection rings, or handle protrusions — the buffer
    // prevents these visual elements from causing apparent overlaps.
    const MEASURED_LAYOUT_BUFFER = 12;

    function estimateNodeSize(node: DependencyNode): { width: number; height: number } {
      // Prefer actual DOM measurements if available (subsequent layout passes)
      const measured = (node as unknown as { measured?: { width?: number; height?: number } }).measured;
      if (measured?.width && measured.height && measured.width > 10 && measured.height > 10) {
        return {
          width: measured.width + MEASURED_LAYOUT_BUFFER,
          height: measured.height + MEASURED_LAYOUT_BUFFER,
        };
      }

      const style = (typeof node.style === 'object' ? node.style : {}) as Record<string, unknown>;
      const data = node.data as Record<string, unknown> | undefined;

      // Extract size hints from style properties
      let hintWidth = Math.max(parseCssSize(style['width']), parseCssSize(style['minWidth']));
      let hintHeight = Math.max(parseCssSize(style['height']), parseCssSize(style['minHeight']));

      // Content-based estimation per node type
      if (node.type === 'module') {
        // Module node layout: header(42) + body content + subnodes(44) + padding(16)
        let estHeight = 42 + 16 + 44 + 16; // ~118px base
        let maxContentWidth = 280; // BaseNode default minWidth

        // Estimate width from label text
        const label = data?.['label'];
        if (typeof label === 'string') {
          maxContentWidth = Math.max(maxContentWidth, estimateTextWidth(label, 120)); // header + badge
        }

        const properties = data?.['properties'];
        if (Array.isArray(properties) && properties.length > 0) {
          estHeight += 28; // metadata section toggle header
          for (const prop of properties) {
            const p = prop as { name?: string; type?: string };
            estHeight += 22;
            const propText = `${p.name ?? ''}: ${p.type ?? ''}`;
            maxContentWidth = Math.max(maxContentWidth, estimateTextWidth(propText, 80));
          }
        }

        const extDeps = data?.['externalDependencies'];
        if (Array.isArray(extDeps) && extDeps.length > 0) {
          estHeight += 28; // external deps section toggle header
          for (const dep of extDeps) {
            const d = dep as { packageName?: string; symbols?: string[] };
            estHeight += 42;
            const pkgName = d.packageName ?? '';
            const symbols = Array.isArray(d.symbols) ? d.symbols.slice(0, 6).join(', ') : '';
            maxContentWidth = Math.max(maxContentWidth, estimateTextWidth(pkgName, 48));
            maxContentWidth = Math.max(maxContentWidth, estimateTextWidth(symbols, 48));
          }
        }

        // Embedded symbols in compact mode (expanded by default)
        const symbols = data?.['symbols'];
        if (Array.isArray(symbols) && symbols.length > 0) {
          // Type-category CollapsibleSection headers (Classes, Interfaces)
          const typeCategories = new Set(
            (symbols as { type?: string }[]).map(s => s.type).filter(Boolean),
          );
          estHeight += typeCategories.size * 28;

          for (const sym of symbols) {
            const s = sym as { name?: string; properties?: unknown[]; methods?: unknown[] };
            estHeight += 34; // Symbol card header (badge + name + toggle)
            const props = Array.isArray(s.properties) ? s.properties : [];
            const methods = Array.isArray(s.methods) ? s.methods : [];
            if (props.length > 0) {
              estHeight += 28 + props.length * 22; // Section header + per-property
            }
            if (methods.length > 0) {
              estHeight += 28 + methods.length * 24; // Section header + per-method
            }
            // Width from symbol name and member text
            if (typeof s.name === 'string') {
              maxContentWidth = Math.max(maxContentWidth, estimateTextWidth(s.name, 100));
            }
            for (const p of props) {
              const prop = p as { name?: string; type?: string };
              const propText = `${prop.name ?? ''}: ${prop.type ?? ''}`;
              maxContentWidth = Math.max(maxContentWidth, estimateTextWidth(propText, 80));
            }
            for (const m of methods) {
              const method = m as { name?: string; returnType?: string };
              const sig = `${method.name ?? ''}(): ${method.returnType ?? ''}`;
              maxContentWidth = Math.max(maxContentWidth, estimateTextWidth(sig, 80));
            }
          }
        }

        hintWidth = Math.max(hintWidth, maxContentWidth);
        hintHeight = Math.max(hintHeight, estHeight);

      } else if (node.type === 'class' || node.type === 'interface') {
        // Symbol node: header(42) + properties + methods + subnodes(44) + padding
        let estHeight = 42 + 16 + 44 + 16;
        let maxContentWidth = 280; // BaseNode default minWidth

        // Estimate width from label text
        const label = data?.['label'];
        if (typeof label === 'string') {
          maxContentWidth = Math.max(maxContentWidth, estimateTextWidth(label, 120)); // header + badge
        }

        const properties = data?.['properties'];
        if (Array.isArray(properties)) {
          estHeight += properties.length * 22;
          for (const prop of properties) {
            const p = prop as { name?: string; type?: string };
            const propText = `${p.name ?? ''}: ${p.type ?? ''}`;
            maxContentWidth = Math.max(maxContentWidth, estimateTextWidth(propText, 80));
          }
        }

        const methods = data?.['methods'];
        if (Array.isArray(methods)) {
          estHeight += methods.length * 24;
          for (const method of methods) {
            const m = method as { name?: string; returnType?: string; params?: string };
            const sig = `${m.name ?? ''}(${m.params ?? ''}): ${m.returnType ?? ''}`;
            maxContentWidth = Math.max(maxContentWidth, estimateTextWidth(sig, 80));
          }
        }

        hintWidth = Math.max(hintWidth, maxContentWidth);
        hintHeight = Math.max(hintHeight, estHeight);

      } else if (node.type === 'package') {
        hintWidth = Math.max(hintWidth, 300);
        hintHeight = Math.max(hintHeight, 200);

      } else if (node.type === 'group') {
        if (data?.['isCollapsed'] === true) {
          // Collapsed folder: compact leaf node representation
          hintWidth = Math.max(hintWidth, 200);
          hintHeight = Math.max(hintHeight, 48);
        } else {
          // Expanded group: ELK will compute final size from children.
          hintWidth = Math.max(hintWidth, 250);
          hintHeight = Math.max(hintHeight, 80);
        }

      } else if (node.type === 'hub') {
        // Invisible proxy node for edge aggregation — minimal footprint
        hintWidth = 8;
        hintHeight = 8;

      } else if (node.type === 'property' || node.type === 'method') {
        hintWidth = Math.max(hintWidth, 200);
        hintHeight = Math.max(hintHeight, 40);
      }

      return {
        width: Math.max(hintWidth, defaultWidth),
        height: Math.max(hintHeight, defaultHeight),
      };
    }

    // Map VueFlow directions to ELK's expected values
    const directionMap: Record<string, string> = {
      RIGHT: 'RIGHT',
      LEFT: 'LEFT',
      DOWN: 'DOWN',
      UP: 'UP',
    };
    const elkDirection = directionMap[config.direction] ?? 'RIGHT';

    // Build hierarchical structure for ELK
    const nodeMap = new Map<string, ElkNode>();
    const inputNodeById = new Map(nodes.map((node) => [node.id, node]));
    const nodeIdSet = new Set(nodes.map((node) => node.id));
    const rootNodes: ElkNode[] = [];
    const childIdsByParent = new Map<string, string[]>();

    nodes.forEach((node) => {
      const parentNodeId = (node as { parentNode?: string }).parentNode;
      if (!parentNodeId) {
        return;
      }
      const children = childIdsByParent.get(parentNodeId) ?? [];
      children.push(node.id);
      childIdsByParent.set(parentNodeId, children);
    });

    // First pass: create all ELK nodes with content-aware size estimates
    nodes.forEach((node) => {
      const { width: nodeWidth, height: nodeHeight } = estimateNodeSize(node);

      const elkNode: ElkNode = {
        id: node.id,
        width: nodeWidth,
        height: nodeHeight,
        children: [],
      };
      nodeMap.set(node.id, elkNode);
    });

    // Add layout options to nodes that will have children (compound nodes)
    nodeMap.forEach((elkNode) => {
      const hasChildren = childIdsByParent.has(elkNode.id);
      if (hasChildren) {
        const sourceNode = inputNodeById.get(elkNode.id);
        const layoutInsets = sourceNode?.data?.layoutInsets as { top?: number } | undefined;
        const topInset = typeof layoutInsets?.top === 'number' && layoutInsets.top > 0 ? layoutInsets.top : 120;

        elkNode.layoutOptions = {
          // Child nodes inside containers should stack vertically regardless of global direction.
          'elk.algorithm': 'layered',
          'elk.direction': 'DOWN',
          // Reserve top area for node header/body/subnodes labels.
          'elk.padding': `[top=${String(topInset)},left=24,bottom=24,right=24]`,
          'elk.spacing.nodeNode': '24',
          'elk.layered.spacing.nodeNodeBetweenLayers': '24',
          'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        };
      }
    });

    // Second pass: build hierarchy based on parentNode
    nodes.forEach((node) => {
      const elkNode = nodeMap.get(node.id);
      if (!elkNode) return;

      const parentNodeId = (node as unknown as { parentNode?: string }).parentNode;
      if (parentNodeId) {
        const parent = nodeMap.get(parentNodeId);
        if (parent) {
          parent.children = parent.children ?? [];
          parent.children.push(elkNode);
        }
      } else {
        rootNodes.push(elkNode);
      }
    });

    // Filter edges to only include valid connections and exclude containment edges
    // Containment is handled by ELK's hierarchy structure, not as edges
    const validEdges = edges.filter((edge) => {
      const edgeType = (edge.data as { type?: string } | undefined)?.type;
      const isValid = nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target);
      const isNotContainment = edgeType !== 'contains';
      return isValid && isNotContainment;
    });

    // Define ELK edge type - ELK uses sources/targets arrays
    interface ElkEdge {
      id: string;
      sources: string[];
      targets: string[];
      layoutOptions?: Record<string, string>;
    }

    // Create ELK edges with correct format (only non-containment edges for layout)
    const elkEdges: ElkEdge[] = validEdges.map((edge) => {
      const elkEdge: ElkEdge = {
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      };
      // Hub→target edges: keep hubs close to their targets via high shortness priority
      if (edge.data?.hubAggregated) {
        elkEdge.layoutOptions = { 'elk.layered.priority.shortness': '100' };
      }
      return elkEdge;
    });

    // Define ELK graph type
    interface ElkGraph {
      id: string;
      layoutOptions: Record<string, string>;
      children: ElkNode[];
      edges: ElkEdge[];
    }

    // --- Degree-weighted layer constraints ---
    // When enabled, nodes with more outgoing edges gravitate toward the A-side (start)
    // and nodes with more incoming edges gravitate toward the B-side (end) of the layout.
    if (config.algorithm === 'layered' && config.degreeWeightedLayers) {
      const PRIORITY_SCALE = 10;

      // Compute in-degree and out-degree from non-containment edges
      const inDegree = new Map<string, number>();
      const outDegree = new Map<string, number>();

      for (const edge of validEdges) {
        outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
        inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
      }

      // Compute flow score per node: 1.0 = pure source, 0.0 = pure sink, 0.5 = balanced/isolated
      const flowScore = new Map<string, number>();
      for (const nodeId of nodeIdSet) {
        const inD = inDegree.get(nodeId) ?? 0;
        const outD = outDegree.get(nodeId) ?? 0;
        const total = inD + outD;
        flowScore.set(nodeId, total > 0 ? outD / total : 0.5);
      }

      // Apply layerConstraint to root nodes only (children participate in parent sub-layout)
      for (const elkNode of rootNodes) {
        const score = flowScore.get(elkNode.id) ?? 0.5;
        const outD = outDegree.get(elkNode.id) ?? 0;
        const inD = inDegree.get(elkNode.id) ?? 0;

        if (score === 1.0 && outD > 0) {
          elkNode.layoutOptions = {
            ...elkNode.layoutOptions,
            'elk.layered.layering.layerConstraint': 'FIRST',
          };
        } else if (score === 0.0 && inD > 0) {
          elkNode.layoutOptions = {
            ...elkNode.layoutOptions,
            'elk.layered.layering.layerConstraint': 'LAST',
          };
        }
      }

      // Apply per-edge priorities based on flow score delta:
      // - priority.direction: edges from sources→sinks point in the layout direction (cycle breaking)
      // - priority.shortness: edges between very different roles are kept short (layering phase)
      for (const elkEdge of elkEdges) {
        const sourceId = elkEdge.sources[0];
        const targetId = elkEdge.targets[0];
        if (!sourceId || !targetId) continue;

        const srcScore = flowScore.get(sourceId) ?? 0.5;
        const tgtScore = flowScore.get(targetId) ?? 0.5;

        const dirPriority = Math.max(0, Math.round((srcScore - tgtScore) * PRIORITY_SCALE));
        const delta = Math.abs(srcScore - tgtScore);
        const shortness = Math.max(1, Math.round(delta * PRIORITY_SCALE));

        const edgeOpts: Record<string, string> = { ...elkEdge.layoutOptions };
        if (dirPriority > 0) {
          edgeOpts['elk.layered.priority.direction'] = String(dirPriority);
        }
        edgeOpts['elk.layered.priority.shortness'] = String(shortness);
        elkEdge.layoutOptions = edgeOpts;
      }
    }

    // Compute an average node size to inform spacing parameters for non-layered algorithms.
    // Radial/force/stress algorithms need larger spacing because they don't natively
    // account for node dimensions as well as layered does.
    const avgNodeWidth = rootNodes.reduce((sum, n) => sum + n.width, 0) / Math.max(rootNodes.length, 1);
    const avgNodeHeight = rootNodes.reduce((sum, n) => sum + n.height, 0) / Math.max(rootNodes.length, 1);
    const avgNodeDiagonal = Math.sqrt(avgNodeWidth * avgNodeWidth + avgNodeHeight * avgNodeHeight);

    // Build layout options based on algorithm
    const layoutOptions: Record<string, string> = {
      'elk.algorithm': config.algorithm,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': String(config.nodesep),
      'elk.spacing.edgeNode': String(config.edgesep),
      'elk.padding': '[top=50,left=50,bottom=50,right=50]',
      'elk.spacing.componentComponent': '30',
      'elk.spacing.portPort': '10',
      // Global preferences for clearer, orthogonal routing and consistent ports
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.portAlignment.default': 'CENTER',
    };

    // Add algorithm-specific options
    if (config.algorithm === 'layered') {
      layoutOptions['elk.direction'] = elkDirection;
      layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = String(config.ranksep);
      layoutOptions['elk.layered.spacing.edgeNodeBetweenLayers'] = String(config.edgesep);
      layoutOptions['elk.layered.nodePlacement.strategy'] = 'BRANDES_KOEPF';
      layoutOptions['elk.layered.nodePlacement.bk.fixedAlignment'] = 'NONE';
      layoutOptions['elk.layered.layering.strategy'] = 'NETWORK_SIMPLEX';
      layoutOptions['elk.layered.cycleBreaking.strategy'] = 'GREEDY';
      layoutOptions['elk.layered.crossingMinimization.strategy'] = 'LAYER_SWEEP';
      layoutOptions['elk.layered.compaction.postCompaction.strategy'] = 'EDGE_LENGTH';
      layoutOptions['elk.layered.mergeEdges'] = 'true';
    } else if (config.algorithm === 'radial') {
      // Radius must be large enough so adjacent rings don't overlap — use at least
      // half the average node diagonal plus user-configured rank separation.
      const radialRadius = Math.max(config.ranksep, avgNodeDiagonal * 0.75 + config.nodesep);
      layoutOptions['elk.radial.radius'] = String(Math.round(radialRadius));
      layoutOptions['elk.radial.compactionStepSize'] = '0.1';
      layoutOptions['elk.radial.compaction'] = 'true';
      layoutOptions['elk.radial.sorter'] = 'QUADRANTS';
      layoutOptions['elk.radial.wedgeCriteria'] = 'CONNECTIONS';
      layoutOptions['elk.radial.optimizeDistance'] = 'true';
      // Increase node spacing for radial — nodes spread on arcs need more room
      layoutOptions['elk.spacing.nodeNode'] = String(Math.max(config.nodesep, Math.round(avgNodeWidth * 0.5)));
      layoutOptions['elk.edgeRouting'] = 'SPLINES';
    } else if (config.algorithm === 'force') {
      // Repulsion must be proportional to node size so large nodes push each other apart
      const repulsion = Math.max(5.0, avgNodeDiagonal / 20);
      layoutOptions['elk.force.repulsion'] = String(repulsion);
      layoutOptions['elk.force.temperature'] = '0.001';
      layoutOptions['elk.force.iterations'] = '300';
      // Increase spacing proportional to node size
      layoutOptions['elk.spacing.nodeNode'] = String(Math.max(config.nodesep, Math.round(avgNodeWidth * 0.6)));
      layoutOptions['elk.edgeRouting'] = 'SPLINES';
    } else {
      // stress algorithm — desired edge length must accommodate node sizes
      const desiredLength = Math.max(config.ranksep, Math.round(avgNodeDiagonal + config.nodesep));
      layoutOptions['elk.stress.desiredEdgeLength'] = String(desiredLength);
      layoutOptions['elk.stress.epsilon'] = '0.0001';
      layoutOptions['elk.stress.iterations'] = '300';
      layoutOptions['elk.spacing.nodeNode'] = String(Math.max(config.nodesep, Math.round(avgNodeWidth * 0.6)));
      layoutOptions['elk.edgeRouting'] = 'SPLINES';
    }

    // Create the ELK graph with hierarchical structure
    const elkGraph: ElkGraph = {
      id: 'root',
      layoutOptions,
      children: rootNodes,
      edges: elkEdges,
    };

    const layoutedGraph = await elk.layout(elkGraph);

    // Extract positions from the hierarchical layout recursively
    // For VueFlow, nested nodes need RELATIVE positions to their parent, not absolute
    const positionMap = new Map<string, { x: number; y: number; width: number; height: number }>();

    function extractPositions(elkNodes: ElkNode[]): void {
      elkNodes.forEach((node) => {
        // ELK returns positions relative to the parent for nested nodes
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        const width = node.width;
        const height = node.height;
        positionMap.set(node.id, { x, y, width, height });

        // Recursively process children
        if (node.children && node.children.length > 0) {
          extractPositions(node.children);
        }
      });
    }

    if (layoutedGraph.children) {
      extractPositions(layoutedGraph.children);
    }

    // Post-processing: ensure children don't overlap and parents contain all children.
    // ELK should handle this, but we add a safety net.
    const CONTAINER_HORIZONTAL_PADDING = 48;
    const DEFAULT_CONTAINER_TOP_PADDING = 120; // space for header/body content
    const CONTAINER_BOTTOM_PADDING = 48;

    // Group nodes by parent so we only compare siblings in the sweep.
    const nodesByParent = new Map<string, string[]>();
    nodes.forEach((node) => {
      const parentId = (node as { parentNode?: string }).parentNode ?? '__root__';
      const siblings = nodesByParent.get(parentId) ?? [];
      siblings.push(node.id);
      nodesByParent.set(parentId, siblings);
    });

    // Vue Flow uses box-sizing: border-box, so the rendered size matches the
    // CSS width/height exactly. A 40px gap provides comfortable visual spacing.
    const OVERLAP_GAP = 40;

    // Compute depth for each parent so we can expand bottom-up.
    // Depth 0 = leaf parent (children have no sub-children).
    // Higher depth = further from leaves.
    const parentDepth = new Map<string, number>();
    function computeParentDepth(nodeId: string): number {
      const cached = parentDepth.get(nodeId);
      if (cached !== undefined) return cached;
      const children = childIdsByParent.get(nodeId);
      if (!children || children.length === 0) {
        parentDepth.set(nodeId, 0);
        return 0;
      }
      let maxChildDepth = 0;
      for (const childId of children) {
        if (childIdsByParent.has(childId)) {
          maxChildDepth = Math.max(maxChildDepth, computeParentDepth(childId) + 1);
        }
      }
      parentDepth.set(nodeId, maxChildDepth);
      return maxChildDepth;
    }
    childIdsByParent.forEach((_, parentId) => computeParentDepth(parentId));

    // Sort parents ascending by depth: leaf parents first, grandparents later.
    // This ensures bottom-up expansion (modules before packages).
    const sortedParentIds = [...childIdsByParent.keys()].sort(
      (a, b) => (parentDepth.get(a) ?? 0) - (parentDepth.get(b) ?? 0)
    );

    /**
     * Enforce minimum child positions: children must be below the header area
     * and past the left padding boundary.
     */
    function enforceMinPositions(): void {
      childIdsByParent.forEach((childIds, parentId) => {
        const parentSourceNode = inputNodeById.get(parentId);
        const layoutInsets = parentSourceNode?.data?.layoutInsets as { top?: number } | undefined;
        const containerTopPadding =
          typeof layoutInsets?.top === 'number' && layoutInsets.top > 0 ? layoutInsets.top : DEFAULT_CONTAINER_TOP_PADDING;

        for (const childId of childIds) {
          const box = positionMap.get(childId);
          if (!box) continue;
          if (box.y < containerTopPadding) box.y = containerTopPadding;
          if (box.x < CONTAINER_HORIZONTAL_PADDING) box.x = CONTAINER_HORIZONTAL_PADDING;
        }
      });
    }

    /**
     * Expand parent nodes to fully contain their children, processing
     * bottom-up (leaf parents first) so that grandparents see fully-expanded
     * children and compute correct sizes.
     */
    function expandParentsBottomUp(): void {
      for (const parentId of sortedParentIds) {
        const childIds = childIdsByParent.get(parentId);
        if (!childIds) continue;

        const parentBox = positionMap.get(parentId);
        if (!parentBox) continue;

        const childBoxes = childIds
          .map((id) => positionMap.get(id))
          .filter((box): box is { x: number; y: number; width: number; height: number } => Boolean(box));

        if (childBoxes.length === 0) continue;

        const maxRight = Math.max(...childBoxes.map((box) => box.x + box.width));
        const maxBottom = Math.max(...childBoxes.map((box) => box.y + box.height));

        parentBox.width = Math.max(parentBox.width, maxRight + CONTAINER_HORIZONTAL_PADDING);
        parentBox.height = Math.max(parentBox.height, maxBottom + CONTAINER_BOTTOM_PADDING);
      }
    }

    /**
     * Forward-only sweep: for each sibling group, sort by position, then push
     * overlapping nodes forward (down in Y-sweep, right in X-sweep).
     * Returns true if any overlap was found and resolved.
     */
    function sweepResolveSiblings(): boolean {
      let anyOverlap = false;

      nodesByParent.forEach((siblingIds) => {
        if (siblingIds.length < 2) return;

        const siblings = siblingIds
          .map((id) => ({ id, box: positionMap.get(id) }))
          .filter((entry): entry is { id: string; box: { x: number; y: number; width: number; height: number } } =>
            Boolean(entry.box)
          );

        // --- Vertical sweep: sort by Y, push overlapping nodes down ---
        siblings.sort((a, b) => {
          const yDiff = a.box.y - b.box.y;
          if (Math.abs(yDiff) > 1) return yDiff;
          return a.box.x - b.box.x;
        });

        for (let i = 0; i < siblings.length; i += 1) {
          const current = siblings[i];
          if (!current) continue;

          for (let j = 0; j < i; j += 1) {
            const placed = siblings[j];
            if (!placed) continue;

            const hOverlap = current.box.x < placed.box.x + placed.box.width + OVERLAP_GAP &&
                              current.box.x + current.box.width + OVERLAP_GAP > placed.box.x;
            const vOverlap = current.box.y < placed.box.y + placed.box.height + OVERLAP_GAP &&
                              current.box.y + current.box.height + OVERLAP_GAP > placed.box.y;

            if (hOverlap && vOverlap) {
              anyOverlap = true;
              current.box.y = placed.box.y + placed.box.height + OVERLAP_GAP;
            }
          }
        }

        // --- Horizontal sweep: sort by X, push overlapping nodes right ---
        siblings.sort((a, b) => {
          const xDiff = a.box.x - b.box.x;
          if (Math.abs(xDiff) > 1) return xDiff;
          return a.box.y - b.box.y;
        });

        for (let i = 0; i < siblings.length; i += 1) {
          const current = siblings[i];
          if (!current) continue;

          for (let j = 0; j < i; j += 1) {
            const placed = siblings[j];
            if (!placed) continue;

            const hOverlap = current.box.x < placed.box.x + placed.box.width + OVERLAP_GAP &&
                              current.box.x + current.box.width + OVERLAP_GAP > placed.box.x;
            const vOverlap = current.box.y < placed.box.y + placed.box.height + OVERLAP_GAP &&
                              current.box.y + current.box.height + OVERLAP_GAP > placed.box.y;

            if (hOverlap && vOverlap) {
              anyOverlap = true;
              current.box.x = placed.box.x + placed.box.width + OVERLAP_GAP;
            }
          }
        }
      });

      return anyOverlap;
    }

    // Enforce minimum child positions before sweep cycle.
    enforceMinPositions();

    // Iteratively resolve overlaps with correct expansion order:
    // 1. expandParentsBottomUp: compute correct sizes (leaf parents first)
    // 2. sweepResolveSiblings: fix overlaps using those correct sizes
    // Only exit when sweep confirms 0 overlaps with up-to-date sizes.
    for (let cycle = 0; cycle < 20; cycle += 1) {
      expandParentsBottomUp();
      const hadOverlaps = sweepResolveSiblings();
      if (!hadOverlaps) break;
      enforceMinPositions();
    }

    // Apply positions from ELK layout to all nodes.
    // Container nodes (parents) get explicit width/height so they encompass children.
    // Non-container (leaf) nodes are left to size naturally from their content —
    // the two-pass layout system will re-measure DOM sizes on the second pass.
    //
    // CRITICAL: Strip `expandParent` and the original `extent` from output nodes.
    // `expandParent` causes Vue Flow to auto-expand parents, overriding computed layout.
    // The original `extent` may be a Vue reactive Proxy (from prior layout passes),
    // which can't survive structured clone via postMessage. Instead, re-apply a fresh
    // `extent: 'parent'` string on child nodes so Vue Flow enforces drag containment.
    const parentNodeIds = new Set(childIdsByParent.keys());
    const newNodes = nodes.map((node) => {
      const position = positionMap.get(node.id);
      const { expandParent: _ep, extent: _ext, ...nodeBase } = node;
      const isChild = !!(node as { parentNode?: string }).parentNode;

      if (position) {
        const hasChildren = parentNodeIds.has(node.id);
        const style = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};

        // Container nodes need explicit dimensions to encompass their children.
        // Leaf nodes size from their DOM content — no explicit width/height.
        const sizeStyle = hasChildren
          ? {
              width: String(Math.max(position.width, defaultWidth)) + 'px',
              height: String(Math.max(position.height, defaultHeight)) + 'px',
              overflow: 'visible' as const,
            }
          : {};

        return {
          ...nodeBase,
          ...(isChild ? { extent: 'parent' as const } : {}),
          position: { x: position.x, y: position.y },
          style: {
            ...style,
            ...sizeStyle,
          },
        };
      }
      return { ...nodeBase, ...(isChild ? { extent: 'parent' as const } : {}) };
    });

    // --- Pre-compute edge anchor points (#19) ---
    // Compute absolute positions for each node (child positions are relative to parent).
    const absolutePositionMap = new Map<string, { x: number; y: number; width: number; height: number }>();

    function computeAbsolutePosition(nodeId: string): { x: number; y: number; width: number; height: number } | null {
      const cached = absolutePositionMap.get(nodeId);
      if (cached) return cached;

      const pos = positionMap.get(nodeId);
      if (!pos) return null;

      const node = inputNodeById.get(nodeId);
      const parentId = (node as { parentNode?: string } | undefined)?.parentNode;

      if (parentId) {
        const parentAbs = computeAbsolutePosition(parentId);
        if (parentAbs) {
          const abs = { x: pos.x + parentAbs.x, y: pos.y + parentAbs.y, width: pos.width, height: pos.height };
          absolutePositionMap.set(nodeId, abs);
          return abs;
        }
      }

      absolutePositionMap.set(nodeId, pos);
      return pos;
    }

    /**
     * Compute the edge handle anchor point based on node position, size, and layout direction.
     * Matches Vue Flow's handle placement convention for source/target handles.
     */
    function getHandleAnchor(
      pos: { x: number; y: number; width: number; height: number },
      direction: string,
      role: 'source' | 'target'
    ): { x: number; y: number } {
      if (direction === 'RIGHT' || direction === 'LEFT') {
        // Horizontal layout: source=right, target=left (for RIGHT); reversed for LEFT
        if ((direction === 'RIGHT' && role === 'source') || (direction === 'LEFT' && role === 'target')) {
          return { x: pos.x + pos.width, y: pos.y + pos.height / 2 };
        }
        return { x: pos.x, y: pos.y + pos.height / 2 };
      }
      // Vertical layout: source=bottom, target=top (for DOWN); reversed for UP
      if ((direction === 'DOWN' && role === 'source') || (direction === 'UP' && role === 'target')) {
        return { x: pos.x + pos.width / 2, y: pos.y + pos.height };
      }
      return { x: pos.x + pos.width / 2, y: pos.y };
    }

    // Attach pre-computed anchor points to each edge for faster viewport culling
    const edgesWithAnchors = edges.map((edge) => {
      const sourcePos = computeAbsolutePosition(edge.source);
      const targetPos = computeAbsolutePosition(edge.target);

      if (!sourcePos || !targetPos) return edge;

      const sourceAnchor = getHandleAnchor(sourcePos, config.direction, 'source');
      const targetAnchor = getHandleAnchor(targetPos, config.direction, 'target');

      return {
        ...edge,
        data: {
          ...(edge.data as Record<string, unknown> | undefined),
          sourceAnchor,
          targetAnchor,
        },
      };
    });

    // Return all edges (including containment edges), not just the ones used for layout
    self.postMessage({
      type: 'layout-complete',
      payload: { nodes: newNodes, edges: edgesWithAnchors },
    });
  } catch (error) {
    console.error('ELK layout error:', error);
    // Fallback: return nodes unchanged
    self.postMessage({
      type: 'layout-complete',
      payload: { nodes, edges },
    });
  }
};

// Export empty object to satisfy TypeScript
export {};
