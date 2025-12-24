import ModuleNode from './ModuleNode.vue';
import PackageNode from './PackageNode.vue';
import SymbolNode from './SymbolNode.vue';

import type { Component } from 'vue';

/**
 * Custom node types for the VueFlow dependency graph
 * Static component mapping - frozen to prevent Vue from making it reactive
 */
export const nodeTypes: Record<string, Component> = Object.freeze({
  package: PackageNode,
  module: ModuleNode,
  class: SymbolNode,
  interface: SymbolNode,
  enum: SymbolNode,
  type: SymbolNode,
  function: SymbolNode,
  group: SymbolNode,
  property: SymbolNode,
  method: SymbolNode,
});
