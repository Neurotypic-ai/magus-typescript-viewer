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
  /** Members of an SCC supernode (only set on `type: 'scc'` nodes). */
  sccMembers?: string[];
  /** Positions of SCC members relative to the supernode's top-left corner. */
  sccMemberPositions?: Record<string, { x: number; y: number }>;
  /** Bounding-box size for an SCC supernode (width/height in CSS pixels). */
  sccSize?: { width: number; height: number };
  [key: string]: unknown;
}
