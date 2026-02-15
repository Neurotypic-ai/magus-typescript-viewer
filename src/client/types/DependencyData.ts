import type { NodeMethod } from './NodeMethod';
import type { NodeProperty } from './NodeProperty';
import type { SubnodeMetadata } from './SubnodeMetadata';
import type { MemberMetadata } from './MemberMetadata';
import type { EmbeddedSymbol } from './EmbeddedSymbol';
import type { NodeDiagnostics } from './NodeDiagnostics';
import type { LayoutInsets } from './LayoutInsets';
import type { EmbeddedModuleEntity } from './EmbeddedModuleEntity';
import type { ExternalDependencyRef } from './ExternalDependencyRef';

/**
 * Node data structure for dependency nodes
 */
export interface DependencyData {
  label: string;
  parentId?: string;
  methods?: NodeMethod[];
  properties?: NodeProperty[];
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
  collapsible?: boolean;
  [key: string]: unknown;
}
