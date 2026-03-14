import fs from 'node:fs/promises';
import path from 'node:path';

import { INSIGHT_KINDS } from './types';

import type { InsightKind, InsightResult } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface InsightIgnoreRules {
  suppressedKinds: Set<InsightKind>;
  filePatterns: RegExp[];
  kindFilePatterns: Map<InsightKind, RegExp[]>;
}

// ── Glob-to-Regex conversion ─────────────────────────────────────────────────

function globToRegex(pattern: string): RegExp {
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === undefined) break;
    if (ch === '*' && pattern[i + 1] === '*') {
      regex += '.*';
      i += 2;
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

// ── Validation ───────────────────────────────────────────────────────────────

const KNOWN_KINDS_SET: ReadonlySet<string> = new Set(INSIGHT_KINDS);

function isInsightKind(value: string): value is InsightKind {
  return KNOWN_KINDS_SET.has(value);
}

// ── Parser ───────────────────────────────────────────────────────────────────

export function parseInsightIgnore(content: string): InsightIgnoreRules {
  const suppressedKinds = new Set<InsightKind>();
  const filePatterns: RegExp[] = [];
  const kindFilePatterns = new Map<InsightKind, RegExp[]>();

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    if (line.startsWith('!')) {
      const kind = line.slice(1).trim();
      if (isInsightKind(kind)) suppressedKinds.add(kind);
      continue;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const maybeKind = line.slice(0, colonIndex).trim();
      const pattern = line.slice(colonIndex + 1).trim();
      if (isInsightKind(maybeKind) && pattern.length > 0) {
        let patterns = kindFilePatterns.get(maybeKind);
        if (!patterns) {
          patterns = [];
          kindFilePatterns.set(maybeKind, patterns);
        }
        patterns.push(globToRegex(pattern));
        continue;
      }
    }

    filePatterns.push(globToRegex(line));
  }

  return { suppressedKinds, filePatterns, kindFilePatterns };
}

// ── Suppression check ────────────────────────────────────────────────────────

function matchesAnyPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(value));
}

function allEntitiesMatch(insight: InsightResult, patterns: RegExp[]): boolean {
  if (insight.entities.length === 0) {
    return false;
  }

  return insight.entities.every((entity) => {
    const nameToCheck = entity.moduleId ?? entity.name;
    return matchesAnyPattern(nameToCheck, patterns);
  });
}

export function shouldSuppressInsight(rules: InsightIgnoreRules, insight: InsightResult): boolean {
  if (rules.suppressedKinds.has(insight.type)) return true;

  if (rules.filePatterns.length > 0 && allEntitiesMatch(insight, rules.filePatterns)) {
    return true;
  }

  const kindPatterns = rules.kindFilePatterns.get(insight.type);
  if (kindPatterns && kindPatterns.length > 0 && allEntitiesMatch(insight, kindPatterns)) {
    return true;
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
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}
