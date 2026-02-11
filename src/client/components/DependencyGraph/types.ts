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
  | 'method';

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
  | 'contains';

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
  [key: string]: unknown;
}

/**
 * Dependency node type extending ReactFlow's Node
 */
export type DependencyNode = Node<DependencyData>;

/**
 * Props for dependency node components - adapted to work with XYFlow's requirements
 */
export interface DependencyProps {
  id: string;
  type: DependencyKind;
  data: DependencyData;
  selected?: boolean;
  width?: number;
  height?: number;
  sourcePosition?: Position;
  targetPosition?: Position;
}

/**
 * Graph edge extending ReactFlow's Edge
 */
export type GraphEdge = Edge<{
  type?: DependencyEdgeKind;
  importName?: string | undefined;
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
}

/**
 * Interface reference structure
 */
export interface InterfaceRef {
  id: string;
  name?: string;
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
