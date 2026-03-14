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
}

export interface TechDebtReport {
  /** All detected markers */
  markers: TechDebtMarker[];
  /** Summary counts by type */
  counts: Record<string, number>;
  /** Overall tech debt score (0-100, lower is better) */
  score: number;
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
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineNumber = i + 1;

    // Detect ts-ignore directives
    if (/\/\/\s*@ts-ignore\b/.test(line)) {
      markers.push({
        type: 'ts_ignore',
        line: lineNumber,
        snippet: truncateSnippet(line),
        severity: 'error',
      });
    }

    // Detect ts-expect-error directives
    if (/\/\/\s*@ts-expect-error\b/.test(line)) {
      markers.push({
        type: 'ts_expect_error',
        line: lineNumber,
        snippet: truncateSnippet(line),
        severity: 'warning',
      });
    }

    // TODO comments (case insensitive)
    if (/\/\/\s*todo\b/i.test(line) || /\/\*.*\btodo\b/i.test(line)) {
      markers.push({
        type: 'todo_comment',
        line: lineNumber,
        snippet: truncateSnippet(line),
        severity: 'info',
      });
    }

    // FIXME comments (case insensitive)
    if (/\/\/\s*fixme\b/i.test(line) || /\/\*.*\bfixme\b/i.test(line)) {
      markers.push({
        type: 'fixme_comment',
        line: lineNumber,
        snippet: truncateSnippet(line),
        severity: 'warning',
      });
    }

    // HACK comments (case insensitive)
    if (/\/\/\s*hack\b/i.test(line) || /\/\*.*\bhack\b/i.test(line)) {
      markers.push({
        type: 'hack_comment',
        line: lineNumber,
        snippet: truncateSnippet(line),
        severity: 'warning',
      });
    }

    // `: any` type annotations — match colon followed by `any` as a word
    if (/:\s*any\b/.test(line)) {
      markers.push({
        type: 'any_type',
        line: lineNumber,
        snippet: truncateSnippet(line),
        severity: 'error',
      });
    }

    // `as any` type assertions
    if (/\bas\s+any\b/.test(line)) {
      markers.push({
        type: 'type_assertion',
        line: lineNumber,
        snippet: truncateSnippet(line),
        severity: 'error',
      });
    }

    // `as unknown as` double type assertions
    if (/\bas\s+unknown\s+as\b/.test(line)) {
      markers.push({
        type: 'type_assertion',
        line: lineNumber,
        snippet: truncateSnippet(line),
        severity: 'error',
      });
    }

    // Non-null assertions: identifier followed by `!` then `.` or `,` or `)` or `[`
    // Avoid matching `!==` and `!=`
    if (/\w!(?:\.|,|\)|\[)/.test(line) && !/!==?/.test(line.replace(/\w!(?:\.|,|\)|\[)/g, ''))) {
      markers.push({
        type: 'non_null_assertion',
        line: lineNumber,
        snippet: truncateSnippet(line),
        severity: 'warning',
      });
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
