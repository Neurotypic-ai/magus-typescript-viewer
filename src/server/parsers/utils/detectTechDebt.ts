/**
 * Detect technical debt markers in TypeScript/JavaScript source code.
 *
 * Scans raw source text for common indicators of tech debt such as
 * `@ts-ignore` directives, `any` type annotations, non-null assertions,
 * and TODO/FIXME/HACK comments.
 */

export interface TechDebtMarker {
  /** Type of technical debt */
  type:
    | 'any_type'
    | 'ts_ignore'
    | 'ts_expect_error'
    | 'type_assertion'
    | 'non_null_assertion'
    | 'todo_comment'
    | 'fixme_comment'
    | 'hack_comment';
  /** Line number where it occurs */
  line: number;
  /** The problematic code snippet (short) */
  snippet: string;
  /** Severity: info, warning, or error */
  severity: 'info' | 'warning' | 'error';
  /** Optional parser context for downstream persistence */
  packageId?: string | undefined;
  moduleId?: string | undefined;
  filePath?: string | undefined;
}

export interface TechDebtReport {
  /** All detected markers */
  markers: TechDebtMarker[];
  /** Summary counts by type */
  counts: Record<string, number>;
  /** Overall tech debt score (0-100, lower is better) */
  score: number;
}

// ── Hoisted regex patterns ──────────────────────────────────────────

const RE_STRING_CONTENT = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const RE_TS_IGNORE = /\/\/\s*@ts-ignore\b/;
const RE_TS_EXPECT_ERROR = /\/\/\s*@ts-expect-error\b/;
const RE_ANY_TYPE = /:\s*any\b/;
const RE_AS_ANY = /\bas\s+any\b/;
const RE_DOUBLE_ASSERT = /\bas\s+unknown\s+as\b/;
const RE_NON_NULL = /\w!(?:\.|,|\)|\[)/;

// ── Data-driven comment marker detection ────────────────────────────

const COMMENT_MARKERS: { keyword: string; type: TechDebtMarker['type']; severity: TechDebtMarker['severity'] }[] = [
  { keyword: 'todo', type: 'todo_comment', severity: 'info' },
  { keyword: 'fixme', type: 'fixme_comment', severity: 'warning' },
  { keyword: 'hack', type: 'hack_comment', severity: 'warning' },
];

/** Pre-compiled regex pairs [lineComment, blockComment] for each comment marker. */
const COMMENT_REGEXES = COMMENT_MARKERS.map(({ keyword }) => ({
  line: new RegExp(`\\/\\/\\s*${keyword}\\b`, 'i'),
  block: new RegExp(`\\/\\*.*\\b${keyword}\\b`, 'i'),
}));

// ── Directive patterns (non-comment, non-data-driven) ───────────────

interface DirectivePattern {
  regex: RegExp;
  type: TechDebtMarker['type'];
  severity: TechDebtMarker['severity'];
}

const DIRECTIVE_PATTERNS: DirectivePattern[] = [
  { regex: RE_TS_IGNORE, type: 'ts_ignore', severity: 'error' },
  { regex: RE_TS_EXPECT_ERROR, type: 'ts_expect_error', severity: 'warning' },
  { regex: RE_ANY_TYPE, type: 'any_type', severity: 'error' },
  { regex: RE_AS_ANY, type: 'type_assertion', severity: 'error' },
  { regex: RE_DOUBLE_ASSERT, type: 'type_assertion', severity: 'error' },
  { regex: RE_NON_NULL, type: 'non_null_assertion', severity: 'warning' },
];

/**
 * Strip the content of string literals from a line, preserving quotes and length.
 * This prevents false-positive pattern matches inside strings.
 */
function stripStringContent(line: string): string {
  return line.replace(RE_STRING_CONTENT, (match) => {
    if (match.length <= 2) return match;
    return (match[0] ?? '') + ' '.repeat(match.length - 2) + (match[match.length - 1] ?? '');
  });
}

/** Maximum length of a snippet included in a marker. */
const MAX_SNIPPET_LENGTH = 80;

/**
 * Truncate a string for use as a snippet, trimming whitespace.
 */
function truncateSnippet(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_SNIPPET_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_SNIPPET_LENGTH - 3) + '...';
}

/**
 * Detect technical debt markers in source code.
 * Works on raw source text to find comments, directives, and type patterns.
 *
 * Detected patterns:
 * - `// @ts-ignore` and `// @ts-expect-error` directives
 * - `// TODO:`, `// FIXME:`, `// HACK:` comments (case insensitive)
 * - `: any` type annotations
 * - `as any` type assertions
 * - `as unknown as` double type assertions
 * - `!.` and `!,` non-null assertions
 *
 * The score is computed as `max(0, 100 - (markers.length * 5))`.
 */
export function detectTechDebt(source: string): TechDebtReport {
  const markers: TechDebtMarker[] = [];
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const strippedLine = stripStringContent(line);
    const lineNumber = i + 1;

    // Check directive / type patterns
    for (const pattern of DIRECTIVE_PATTERNS) {
      if (pattern.regex.test(strippedLine)) {
        markers.push({
          type: pattern.type,
          line: lineNumber,
          snippet: truncateSnippet(line),
          severity: pattern.severity,
        });
      }
    }

    // Check comment markers (TODO, FIXME, HACK)
    for (let j = 0; j < COMMENT_MARKERS.length; j++) {
      // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style -- conflicts with no-non-null-assertion
      const marker = COMMENT_MARKERS[j] as (typeof COMMENT_MARKERS)[number];
      // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style -- conflicts with no-non-null-assertion
      const regexes = COMMENT_REGEXES[j] as (typeof COMMENT_REGEXES)[number];
      if (regexes.line.test(strippedLine) || regexes.block.test(strippedLine)) {
        markers.push({
          type: marker.type,
          line: lineNumber,
          snippet: truncateSnippet(line),
          severity: marker.severity,
        });
      }
    }
  }

  // Build counts
  const counts: Record<string, number> = {};
  for (const marker of markers) {
    counts[marker.type] = (counts[marker.type] ?? 0) + 1;
  }

  // Compute score
  const score = Math.max(0, 100 - markers.length * 5);

  return { markers, counts, score };
}
