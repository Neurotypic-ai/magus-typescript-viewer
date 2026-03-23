import type { Ref } from 'vue';

import type { DependencyNode } from '../types/DependencyNode';

export interface NodePremeasureResult {
  width: number;
  height: number;
  headerHeight?: number;
  bodyHeight?: number;
  subnodesHeight?: number;
}

export interface NodePremeasure {
  hasBatch: Ref<boolean>;
  batchNodes: Ref<DependencyNode[]>;
  measureBatch: (nodes: DependencyNode[]) => Promise<Map<string, NodePremeasureResult>>;
  clearBatch: () => void;
}
