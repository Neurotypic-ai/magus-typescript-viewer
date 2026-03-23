import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

const guardedFiles = [
  'src/client/theme/graphTheme.ts',
  'src/client/theme/graphClasses.ts',
  'src/client/theme/edgeStyles.ts',
  'src/client/composables/useMinimapHelpers.ts',
  'src/client/composables/useSearchHighlighting.ts',
  'src/client/composables/useIsolationMode.ts',
  'src/client/composables/useGraphRenderingState.ts',
  'src/client/graph/drilldown/buildSymbolDrilldown.ts',
  'src/client/graph/drilldown/symbolHelpers.ts',
  'src/client/components/DependencyGraph.vue',
  'src/client/components/GraphControls.vue',
  'src/client/components/IssuesPanel.vue',
  'src/client/components/InsightsDashboard.vue',
  'src/client/components/NodeContextMenu.vue',
  'src/client/components/nodes/BaseNode.vue',
  'src/client/components/nodes/GroupNode.vue',
  'src/client/components/nodes/InsightBadgeStrip.vue',
] as const;

const forbiddenThemeLiterals = [
  '#00ffff',
  '#22d3ee',
  '#67e8f9',
  '#facc15',
  '#4ade80',
  '#f87171',
  '#fbbf24',
  '#ef4444',
  '#60a5fa',
  '#93c5fd',
  'rgb(94, 234, 212)',
  'rgb(147, 197, 253)',
  'rgb(216, 180, 254)',
  'rgb(253, 186, 116)',
  'rgb(251, 191, 36)',
  'rgba(20, 184, 166, 0.08)',
  'rgba(20, 184, 166, 0.2)',
  'rgba(20, 184, 166, 0.3)',
  'rgba(34, 211, 238, 0.26)',
  'rgba(34, 211, 238, 0.34)',
  'rgba(34, 211, 238, 0.6)',
  'rgba(59, 130, 246, 0.06)',
  'rgba(59, 130, 246, 0.1)',
  'rgba(59, 130, 246, 0.15)',
  'rgba(59, 130, 246, 0.2)',
  'rgba(59, 130, 246, 0.25)',
  'rgba(59, 130, 246, 0.35)',
  'rgba(96, 165, 250, 0.12)',
  'rgba(96, 165, 250, 0.15)',
  'rgba(96, 165, 250, 0.2)',
  'rgba(96, 165, 250, 0.25)',
  'rgba(96, 165, 250, 0.3)',
  'rgba(96, 165, 250, 0.45)',
  'rgba(96, 165, 250, 0.65)',
  'rgba(96, 165, 250, 0.85)',
  'rgba(96, 165, 250, 0.9)',
  'rgba(96, 165, 250, 0.95)',
  'rgba(100, 149, 237, 0.15)',
  'rgba(100, 149, 237, 0.4)',
  'rgba(148, 163, 184, 0.8)',
  'rgba(168, 85, 247, 0.1)',
  'rgba(168, 85, 247, 0.2)',
  'rgba(168, 85, 247, 0.35)',
  'rgba(186, 85, 211, 0.15)',
  'rgba(186, 85, 211, 0.4)',
  'rgba(239, 68, 68, 0.18)',
  'rgba(239, 68, 68, 0.24)',
  'rgba(239, 68, 68, 0.35)',
  'rgba(239, 68, 68, 0.5)',
  'rgba(249, 115, 22, 0.2)',
  'rgba(251, 191, 36, 0.18)',
  'rgba(251, 191, 36, 0.2)',
  'rgba(251, 191, 36, 0.28)',
  'rgba(251, 191, 36, 0.5)',
] as const;

describe('theme literal guard', () => {
  it('keeps theme-managed files free of legacy palette literals', () => {
    const violations: string[] = [];

    for (const relativePath of guardedFiles) {
      const content = readFileSync(resolve(repoRoot, relativePath), 'utf8');
      for (const literal of forbiddenThemeLiterals) {
        if (content.includes(literal)) {
          violations.push(`${relativePath}: ${literal}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
