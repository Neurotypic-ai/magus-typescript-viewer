import type { Node } from '@vue-flow/core';

import type { DependencyData } from '../../shared/types/graph/DependencyData';

/**
 * Dependency node type extending Vue Flow's Node
 */
export type DependencyNode = Node<DependencyData>;
