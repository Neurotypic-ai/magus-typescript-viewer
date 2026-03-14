import fs from 'node:fs/promises';
import path from 'node:path';

import type { InsightKind, InsightResult } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface InsightIgnoreRules {
  suppressedKinds: Set<InsightKind>;
  filePatterns: string[];
  kindFilePatterns: Map<InsightKind, string[]>;
}

// ── Glob-to-Regex conversion ─────────────────────────────────────────────────

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports `**` (match anything including `/`), `*` (match anything except `/`),
 * and `?` (match a single character except `/`). Dots are escaped.
 */
function globToRegex(pattern: string): RegExp {
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === undefined) break;
    if (ch === '*' && pattern[i + 1] === '*') {
      regex += '.*';
      i += 2;
      // skip trailing slash after **
      if (pattern[i] === '/') i++;
    } else if (ch === '*') {
      regex += '[^/]*';
      i++;
    } else if (ch === '?') {
      regex += '[^/]';
      i++;
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      regex += '\\' + ch;
      i++;
    } else {
      regex += ch;
      i++;
    }
  }
  return new RegExp(`^${regex}$`);
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegex(p).test(value));
}

// ── Known InsightKind values (for validation) ────────────────────────────────

const KNOWN_KINDS = new Set<string>([
  'circular-imports',
  'import-fan-in',
  'import-fan-out',
  'heavy-external-dependency',
  'god-class',
  'long-parameter-lists',
  'module-size',
  'deep-inheritance',
  'leaky-encapsulation',
  'barrel-file-depth',
  'unexported-entities',
  'type-only-dependencies',
  'orphaned-modules',
  'hub-modules',
  'bridge-modules',
  'cluster-detection',
  'unused-exports',
  'interface-segregation-violations',
  'missing-return-types',
  'async-boundary-mismatches',
  'layering-violations',
  'dependency-depth',
  're-export-chains',
  'duplicate-exports',
  'naming-inconsistency',
  'abstract-no-impl',
  'complexity-hotspot',
  'package-coupling',
]);

function isInsightKind(value: string): value is InsightKind {
  return KNOWN_KINDS.has(value);
}

// ── Parser ───────────────────────────────────────────────────────────────────

export function parseInsightIgnore(content: string): InsightIgnoreRules {
  const suppressedKinds = new Set<InsightKind>();
  const filePatterns: string[] = [];
  const kindFilePatterns = new Map<InsightKind, string[]>();

  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (line === '' || line.startsWith('#')) continue;

    // Global kind suppression: !kind-name
    if (line.startsWith('!')) {
      const kind = line.slice(1).trim();
      if (isInsightKind(kind)) {
        suppressedKinds.add(kind);
      }
      continue;
    }

    // Kind-specific file pattern: kind:pattern
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const maybKind = line.slice(0, colonIndex).trim();
      const pattern = line.slice(colonIndex + 1).trim();
      if (isInsightKind(maybKind) && pattern.length > 0) {
        let patterns = kindFilePatterns.get(maybKind);
        if (!patterns) {
          patterns = [];
          kindFilePatterns.set(maybKind, patterns);
        }
        patterns.push(pattern);
        continue;
      }
    }

    // Bare file pattern: suppress all insights for matching files
    filePatterns.push(line);
  }

  return { suppressedKinds, filePatterns, kindFilePatterns };
}

// ── Suppression check ────────────────────────────────────────────────────────

export function shouldSuppressInsight(rules: InsightIgnoreRules, insight: InsightResult): boolean {
  // Check global kind suppression
  if (rules.suppressedKinds.has(insight.type)) {
    return true;
  }

  // Check if all entities match file patterns (suppress all insights for these files)
  if (rules.filePatterns.length > 0 && insight.entities.length > 0) {
    const allMatch = insight.entities.every((entity) => {
      const nameToCheck = entity.moduleId ?? entity.name;
      return matchesAnyPattern(nameToCheck, rules.filePatterns);
    });
    if (allMatch) return true;
  }

  // Check kind-specific file patterns
  const kindPatterns = rules.kindFilePatterns.get(insight.type);
  if (kindPatterns && kindPatterns.length > 0 && insight.entities.length > 0) {
    const allMatch = insight.entities.every((entity) => {
      const nameToCheck = entity.moduleId ?? entity.name;
      return matchesAnyPattern(nameToCheck, kindPatterns);
    });
    if (allMatch) return true;
  }

  return false;
}

// ── File loader ──────────────────────────────────────────────────────────────

export async function loadInsightIgnore(rootDir: string): Promise<InsightIgnoreRules | null> {
  const filePath = path.join(rootDir, '.insightignore');
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return parseInsightIgnore(content);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}
