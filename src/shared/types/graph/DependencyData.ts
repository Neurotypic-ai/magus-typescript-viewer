import type { IMethod } from '../Method';
import type { IProperty } from '../Property';
import type { EmbeddedModuleEntity } from './EmbeddedModuleEntity';
import type { EmbeddedSymbol } from './EmbeddedSymbol';
import type { ExternalDependencyRef } from './ExternalDependencyRef';
import type { LayoutInsets } from './LayoutInsets';
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
  collapsible?: boolean;
  [key: string]: unknown;
}
