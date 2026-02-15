import { parseDimension } from '../layout/geometryBounds';

import type { DependencyNode } from '../types';

export const collectNodesNeedingInternalsUpdate = (previous: DependencyNode[], next: DependencyNode[]): string[] => {
  const previousById = new Map(previous.map((node) => [node.id, node]));
  const changedIds: string[] = [];

  next.forEach((node) => {
    const prev = previousById.get(node.id);
    if (!prev) {
      changedIds.push(node.id);
      return;
    }

    if (
      prev.sourcePosition !== node.sourcePosition ||
      prev.targetPosition !== node.targetPosition ||
      prev.parentNode !== node.parentNode
    ) {
      changedIds.push(node.id);
      return;
    }

    const prevMeasured = (prev as { measured?: { width?: number; height?: number } }).measured;
    const nextMeasured = (node as { measured?: { width?: number; height?: number } }).measured;
    const prevStyle = typeof prev.style === 'object' ? (prev.style as Record<string, unknown>) : {};
    const nextStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};

    const prevWidth = prevMeasured?.width ?? parseDimension(prevStyle['width']) ?? parseDimension(prev.width) ?? 0;
    const prevHeight =
      prevMeasured?.height ?? parseDimension(prevStyle['height']) ?? parseDimension(prev.height) ?? 0;
    const nextWidth = nextMeasured?.width ?? parseDimension(nextStyle['width']) ?? parseDimension(node.width) ?? 0;
    const nextHeight =
      nextMeasured?.height ?? parseDimension(nextStyle['height']) ?? parseDimension(node.height) ?? 0;

    if (Math.abs(prevWidth - nextWidth) > 1 || Math.abs(prevHeight - nextHeight) > 1) {
      changedIds.push(node.id);
    }
  });

  return changedIds;
};
