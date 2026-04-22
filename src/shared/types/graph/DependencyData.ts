import type { IMethod } from '../Method';
import type { IProperty } from '../Property';
import type { EmbeddedModuleEntity } from './EmbeddedModuleEntity';
import type { EmbeddedSymbol } from './EmbeddedSymbol';
import type { ExternalDependencyRef } from './ExternalDependencyRef';
import type { LayoutInsets } from './LayoutInsets';
import type { LayoutRankTrace } from './LayoutRankTrace';
import type { MemberMetadata } from './MemberMetadata';
import type { NodeDiagnostics } from './NodeDiagnostics';
import type { SubnodeMetadata } from './SubnodeMetadata';

/**
 * Node data structure for dependency nodes
 */
export interface DependencyData {
  label: string;
  parentId?: string;
  methods?: IMethod[];
  properties?: IProperty[];
  implements?: string[];
  extends?: string[];
  imports?: string[];
  exports?: string[];
  externalDependencies?: ExternalDependencyRef[];
  symbols?: EmbeddedSymbol[];
  moduleEntities?: EmbeddedModuleEntity[];
  subnodes?: SubnodeMetadata;
  members?: MemberMetadata;
  diagnostics?: NodeDiagnostics;
  layoutInsets?: LayoutInsets;
  isContainer?: boolean;
  layoutWeight?: number;
  layerIndex?: number;
  sortOrder?: number;
  layoutRankTrace?: LayoutRankTrace;
  collapsible?: boolean;
  // ── Hub / population metadata (Phase 1 + Phase 4) ─────────────────────────
  // `isHub` and `hubDegree` are set by the hub-aware layout passes once the
  // client-side degree has been computed.  `layoutBand` identifies which of
  // the three populations (internal/external/scc) a node belongs to so that
  // downstream code can style or filter by band without re-deriving it from
  // `type`.  `hubAnchorX`/`hubAnchorY` cache the centroid position assigned
  // by `placeHubAnchors` (see `src/client/graph/layout/placeHubAnchors.ts`),
  // which for layer-constrained internal hubs may differ from the column X
  // but for externals is the final placement in the peripheral band.
  isHub?: boolean;
  hubDegree?: number;
  layoutBand?: 'internal' | 'external' | 'scc';
  hubAnchorX?: number;
  hubAnchorY?: number;
  [key: string]: unknown;
}
