import type { Edge, Node, Position } from '@vue-flow/core';

/**
 * Dependency kinds (node types)
 */
export type DependencyKind =
  | 'package'
  | 'module'
  | 'class'
  | 'interface'
  | 'enum'
  | 'type'
  | 'function'
  | 'group'
  | 'property'
  | 'method'
  | 'hub';

/**
 * Edge types for dependency relationships
 */
export type DependencyEdgeKind =
  | 'dependency'
  | 'devDependency'
  | 'peerDependency'
  | 'import'
  | 'export'
  | 'inheritance'
  | 'implements'
  | 'extends'
  | 'contains'
  | 'uses';

export type HandleCategory = 'structural' | 'relational';

/**
 * Node method format for display
 */
export interface NodeMethod {
  id?: string | undefined;
  name: string;
  returnType: string;
  visibility: string;
  signature: string;
}

/**
 * Node property format for display
 */
export interface NodeProperty {
  id?: string | undefined;
  name: string;
  type: string;
  visibility: string;
}

export interface ImportSpecifierRef {
  imported: string;
  local?: string;
  kind: 'value' | 'type' | 'default' | 'namespace' | 'sideEffect';
}

export interface ExternalDependencyRef {
  packageName: string;
  symbols: string[];
  specifiers?: ImportSpecifierRef[];
}

export interface SubnodeMetadata {
  count: number;
  totalCount?: number;
  visibleCount?: number;
  hiddenCount?: number;
  ids?: string[];
  byType?: Partial<Record<DependencyKind, number>>;
  byTypeTotal?: Partial<Record<DependencyKind, number>>;
  byTypeVisible?: Partial<Record<DependencyKind, number>>;
  isContainer?: boolean;
}

export interface MemberMetadata {
  totalCount: number;
  byType?: Partial<Record<'property' | 'method', number>>;
}

/**
 * Symbol data embedded in module nodes during compact mode.
 * Each entry represents a class or interface with its members.
 */
export interface EmbeddedSymbol {
  id: string;
  type: 'class' | 'interface';
  name: string;
  properties: NodeProperty[];
  methods: NodeMethod[];
}

export interface NodeDiagnostics {
  isTestFile: boolean;
  orphanCurrent: boolean;
  orphanGlobal: boolean;
  externalDependencyPackageCount: number;
  externalDependencySymbolCount: number;
  externalDependencyLevel: 'normal' | 'high' | 'critical';
}

export interface LayoutInsets {
  top: number;
}

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

/**
 * Dependency node type extending ReactFlow's Node
 */
export type DependencyNode = Node<DependencyData>;

/**
 * Props for dependency node components - adapted to work with XYFlow's requirements.
 * Widened to include additional NodeWrapper-passed props for forward compatibility.
 */
export interface DependencyProps {
  id: string;
  type: DependencyKind;
  data: DependencyData;
  selected?: boolean;
  dragging?: boolean;
  connectable?: boolean | number | string;
  width?: number;
  height?: number;
  sourcePosition?: Position;
  targetPosition?: Position;
  parentNodeId?: string;
}

/**
 * Graph edge extending ReactFlow's Edge
 */
export type GraphEdge = Edge<{
  type?: DependencyEdgeKind;
  importName?: string | undefined;
  usageKind?: 'method' | 'property' | undefined;
  bundledCount?: number;
  bundledTypes?: DependencyEdgeKind[];
  sourceAnchor?: { x: number; y: number };
  targetAnchor?: { x: number; y: number };
  hubAggregated?: boolean;
  aggregatedCount?: number;
  highwaySegment?: 'exit' | 'highway' | 'entry';
  highwayCount?: number;
  highwayTypes?: DependencyEdgeKind[];
  highwayGroupId?: string;
  highwayTypeBreakdown?: Partial<Record<DependencyEdgeKind, number>>;
}>;

/**
 * Unified graph structure
 */
export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: GraphEdge[];
}

/**
 * Dependency structure for a package
 */
export interface DependencyRef {
  id: string;
  name?: string;
  version?: string;
}

/**
 * Import structure
 */
export interface ImportRef {
  uuid: string;
  name?: string;
  path?: string;
  isExternal?: boolean;
  packageName?: string;
  specifiers?: {
    imported: string;
    local?: string;
    kind: 'value' | 'type' | 'default' | 'namespace' | 'sideEffect';
  }[];
}

/**
 * Interface reference structure
 */
export interface InterfaceRef {
  id: string;
  name?: string;
}

/**
 * Function structure for module-level functions
 */
export interface FunctionStructure {
  id: string;
  name: string;
  returnType: string;
  isAsync: boolean;
}

/**
 * Type alias structure for module-level type aliases
 */
export interface TypeAliasStructure {
  id: string;
  name: string;
  type: string;
  typeParameters?: string[] | undefined;
}

/**
 * Enum structure for module-level enums
 */
export interface EnumStructure {
  id: string;
  name: string;
  members: string[];
}

/**
 * Variable structure for module-level const/let/var
 */
export interface VariableStructure {
  id: string;
  name: string;
  type: string;
  kind: 'const' | 'let' | 'var';
  initializer?: string | undefined;
}

/**
 * Entity embedded in a module node (simpler than EmbeddedSymbol since these don't have properties/methods)
 */
export interface EmbeddedModuleEntity {
  id: string;
  type: 'function' | 'type' | 'enum' | 'const' | 'var';
  name: string;
  detail: string;
  tags?: string[] | undefined;
}

/**
 * Module structure
 */
export interface ModuleStructure {
  id: string;
  name: string;
  package_id: string;
  source: {
    relativePath: string;
    [key: string]: unknown;
  };
  imports?: Record<string, ImportRef>;
  symbol_references?: Record<string, SymbolReferenceRef>;
  classes?: Record<string, ClassStructure>;
  interfaces?: Record<string, InterfaceStructure>;
  functions?: Record<string, FunctionStructure>;
  typeAliases?: Record<string, TypeAliasStructure>;
  enums?: Record<string, EnumStructure>;
  variables?: Record<string, VariableStructure>;
  [key: string]: unknown;
}

export interface SymbolReferenceRef {
  id: string;
  package_id: string;
  module_id: string;
  source_symbol_id?: string | undefined;
  source_symbol_type: 'module' | 'class' | 'interface' | 'function' | 'method' | 'property';
  source_symbol_name?: string | undefined;
  target_symbol_id: string;
  target_symbol_type: 'method' | 'property';
  target_symbol_name: string;
  access_kind: 'method' | 'property';
  qualifier_name?: string | undefined;
}

/**
 * Class structure
 */
export interface ClassStructure {
  id: string;
  name: string;
  extends_id?: string;
  implemented_interfaces?: Record<string, InterfaceRef>;
  methods?: NodeMethod[];
  properties?: NodeProperty[];
  [key: string]: unknown;
}

/**
 * Interface structure
 */
export interface InterfaceStructure {
  id: string;
  name: string;
  extended_interfaces?: Record<string, InterfaceRef>;
  methods?: NodeMethod[];
  properties?: NodeProperty[];
  [key: string]: unknown;
}

/**
 * Package structure for graph visualization
 */
export interface PackageStructure {
  id: string;
  name: string;
  version: string;
  path: string;
  created_at: string;
  dependencies?: Record<string, DependencyRef>;
  devDependencies?: Record<string, DependencyRef>;
  peerDependencies?: Record<string, DependencyRef>;
  modules?: Record<string, ModuleStructure>;
  [key: string]: unknown;
}

/**
 * Package graph structure
 */
export interface DependencyPackageGraph {
  packages: PackageStructure[];
}

/**
 * Layout configuration
 */
export interface LayoutConfig {
  direction: 'TB' | 'LR' | 'RL' | 'BT';
  nodeSpacing: number;
  rankSpacing: number;
  hierarchical: boolean;
}

/**
 * Search results for the graph search component
 */
export interface SearchResult {
  nodes: DependencyNode[];
  edges: GraphEdge[];
  path?: DependencyNode[];
}
