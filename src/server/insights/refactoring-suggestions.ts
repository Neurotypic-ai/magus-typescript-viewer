import type { ImportGraph } from './import-graph';
import type { InsightResult, RefactoringSuggestion } from './types';

export interface EnrichedInsight extends InsightResult {
  suggestions: RefactoringSuggestion[];
}

type SuggestionGenerator = (insight: InsightResult, graph: ImportGraph) => RefactoringSuggestion[];

// ── Per-type suggestion generators ──────────────────────────────────────────

function godClassSuggestions(insight: InsightResult): RefactoringSuggestion[] {
  const suggestions: RefactoringSuggestion[] = [];

  // Check entity details to determine if methods > properties
  const hasMoreMethods = insight.entities.some((e) => {
    if (!e.detail) return false;
    const methodMatch = /(\d+) methods/.exec(e.detail);
    const propMatch = /(\d+) properties/.exec(e.detail);
    if (methodMatch && propMatch) {
      return Number(methodMatch[1]) > Number(propMatch[1]);
    }
    return false;
  });

  if (hasMoreMethods) {
    suggestions.push({
      action: 'Extract class',
      description: 'Extract methods into a separate service/utility class',
      effort: 'medium',
    });
  }

  // Check for many public members (from leaky-encapsulation-like detail or high total)
  const hasLargePublicSurface = insight.entities.some((e) => {
    if (!e.detail) return false;
    const methodMatch = /(\d+) methods/.exec(e.detail);
    const propMatch = /(\d+) properties/.exec(e.detail);
    if (methodMatch && propMatch) {
      return Number(methodMatch[1]) + Number(propMatch[1]) >= 15;
    }
    return false;
  });

  if (hasLargePublicSurface) {
    suggestions.push({
      action: 'Apply facade pattern',
      description: 'Create a simplified public interface to reduce the API surface',
      effort: 'medium',
    });
  }

  // Always suggest at least one thing for god classes
  if (suggestions.length === 0) {
    suggestions.push({
      action: 'Extract class',
      description: 'Split responsibilities into smaller, focused classes',
      effort: 'medium',
    });
  }

  return suggestions;
}

function circularImportsSuggestions(insight: InsightResult, graph: ImportGraph): RefactoringSuggestion[] {
  const suggestions: RefactoringSuggestion[] = [];

  // Find the weakest edge in the cycle (fewest connections)
  const cycleIds = insight.entities.map((e) => e.id);
  if (cycleIds.length >= 2) {
    let weakestEdge: { from: string; to: string; weight: number } | undefined;

    for (let i = 0; i < cycleIds.length; i++) {
      const from = cycleIds[i];
      const to = cycleIds[(i + 1) % cycleIds.length];
      if (!from || !to) continue;
      const deps = graph.adjacency.get(from);
      if (deps?.has(to)) {
        // Use reverse adjacency size as a proxy for edge weight
        const weight = graph.reverseAdjacency.get(to)?.size ?? 0;
        if (!weakestEdge || weight < weakestEdge.weight) {
          weakestEdge = { from, to, weight };
        }
      }
    }

    if (weakestEdge) {
      const fromName = graph.modules.get(weakestEdge.from)?.name ?? weakestEdge.from;
      const toName = graph.modules.get(weakestEdge.to)?.name ?? weakestEdge.to;
      suggestions.push({
        action: 'Break cycle',
        description: `Remove or reverse the import from ${fromName} to ${toName} (weakest link in the cycle)`,
        effort: 'high',
      });
    }
  }

  suggestions.push({
    action: 'Extract shared types',
    description: 'Move shared types to a common module to break the cycle',
    effort: 'high',
  });

  suggestions.push({
    action: 'Use dependency injection',
    description: 'Consider dependency injection to decouple the modules',
    effort: 'high',
  });

  return suggestions;
}

function orphanedModulesSuggestions(): RefactoringSuggestion[] {
  return [
    {
      action: 'Delete or re-export',
      description: 'Delete if unused, or add to a barrel file if it should be discoverable',
      effort: 'low',
    },
  ];
}

function leakyEncapsulationSuggestions(): RefactoringSuggestion[] {
  return [
    {
      action: 'Restrict visibility',
      description: 'Make internal methods private/protected and expose only the public API',
      effort: 'medium',
    },
  ];
}

function importFanInSuggestions(): RefactoringSuggestion[] {
  return [
    {
      action: 'Ensure stability',
      description: 'This is a core utility — ensure it has high test coverage and a stable API',
      effort: 'medium',
    },
    {
      action: 'Split module',
      description: 'Consider splitting into smaller, more focused modules',
      effort: 'medium',
    },
  ];
}

function importFanOutSuggestions(): RefactoringSuggestion[] {
  return [
    {
      action: 'Apply SRP',
      description: 'This module has too many responsibilities — apply Single Responsibility Principle',
      effort: 'high',
    },
    {
      action: 'Introduce facade',
      description: 'Group related imports behind a facade',
      effort: 'high',
    },
  ];
}

function moduleSizeSuggestions(): RefactoringSuggestion[] {
  return [
    {
      action: 'Split module',
      description: 'Split into smaller modules by feature/responsibility',
      effort: 'medium',
    },
  ];
}

function deepInheritanceSuggestions(): RefactoringSuggestion[] {
  return [
    {
      action: 'Prefer composition',
      description: 'Prefer composition over inheritance — extract behavior into mixins or utility functions',
      effort: 'high',
    },
  ];
}

function hubModulesSuggestions(): RefactoringSuggestion[] {
  return [
    {
      action: 'Minimize API surface',
      description: 'This module is a bottleneck — changes here ripple widely. Minimize its API surface.',
      effort: 'medium',
    },
  ];
}

function bridgeModulesSuggestions(): RefactoringSuggestion[] {
  return [
    {
      action: 'Add redundancy',
      description:
        'This module is a single point of failure in the import graph — consider adding redundant paths or splitting',
      effort: 'medium',
    },
  ];
}

// ── Lookup table ────────────────────────────────────────────────────────────

const suggestionGenerators: Partial<Record<InsightResult['type'], SuggestionGenerator>> = {
  'god-class': godClassSuggestions,
  'circular-imports': circularImportsSuggestions,
  'orphaned-modules': orphanedModulesSuggestions,
  'leaky-encapsulation': leakyEncapsulationSuggestions,
  'import-fan-in': importFanInSuggestions,
  'import-fan-out': importFanOutSuggestions,
  'module-size': moduleSizeSuggestions,
  'deep-inheritance': deepInheritanceSuggestions,
  'hub-modules': hubModulesSuggestions,
  'bridge-modules': bridgeModulesSuggestions,
};

// ── Public API ──────────────────────────────────────────────────────────────

export function enrichWithSuggestions(insights: InsightResult[], graph: ImportGraph): EnrichedInsight[] {
  return insights.map((insight) => {
    const generator = suggestionGenerators[insight.type];
    const suggestions = generator ? generator(insight, graph) : [];
    return { ...insight, suggestions };
  });
}
