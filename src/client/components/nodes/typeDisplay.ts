/**
 * Client-side display helpers for flattened TypeScript type strings.
 * Conservative: falls back to the original string when parsing is ambiguous.
 */

export type TypeDisplayKind = 'plain' | 'unionRows' | 'objectBlock';

export interface TypeDisplayModel {
  kind: TypeDisplayKind;
  /** Original normalized input (always set for fallback / title) */
  raw: string;
  /** Union members when kind === 'unionRows' */
  unionMembers?: string[];
  /** Multiline object-like block when kind === 'objectBlock' */
  objectBlock?: string;
}

const WS = /\s/;

function skipWs(s: string, i: number): number {
  let j = i;
  while (j < s.length && WS.test(s.charAt(j))) j++;
  return j;
}

interface DelimiterScanState {
  paren: number;
  bracket: number;
  brace: number;
  angle: number;
  inString: 'none' | 'dquote' | 'squote' | 'template';
}

/**
 * Scan from 0 up to (but not including) `index` and return delimiter depths.
 * Used to detect top-level `|` and safe property-level `,` in object types.
 */
export function scanDelimitersUpTo(s: string, index: number): DelimiterScanState {
  const state: DelimiterScanState = {
    paren: 0,
    bracket: 0,
    brace: 0,
    angle: 0,
    inString: 'none',
  };

  let stringEscape = false;
  let templateExprDepth = 0;

  for (let k = 0; k < index && k < s.length; k++) {
    const c = s[k];
    const next = k + 1 < s.length ? s[k + 1] : '';

    if (state.inString !== 'none') {
      if (state.inString === 'template') {
        if (c === '`') {
          state.inString = 'none';
          templateExprDepth = 0;
        } else if (c === '$' && next === '{') {
          templateExprDepth++;
        } else if (c === '}' && templateExprDepth > 0) {
          templateExprDepth--;
        }
        continue;
      }
      if (stringEscape) {
        stringEscape = false;
        continue;
      }
      if (c === '\\') {
        stringEscape = true;
        continue;
      }
      if (state.inString === 'dquote' && c === '"') state.inString = 'none';
      else if (state.inString === 'squote' && c === "'") state.inString = 'none';
      continue;
    }

    if (c === '"') {
      state.inString = 'dquote';
      continue;
    }
    if (c === "'") {
      state.inString = 'squote';
      continue;
    }
    if (c === '`') {
      state.inString = 'template';
      templateExprDepth = 0;
      continue;
    }

    switch (c) {
      case '(':
        state.paren++;
        break;
      case ')':
        state.paren = Math.max(0, state.paren - 1);
        break;
      case '[':
        state.bracket++;
        break;
      case ']':
        state.bracket = Math.max(0, state.bracket - 1);
        break;
      case '{':
        state.brace++;
        break;
      case '}':
        state.brace = Math.max(0, state.brace - 1);
        break;
      case '<':
        state.angle++;
        break;
      case '>':
        state.angle = Math.max(0, state.angle - 1);
        break;
      default:
        break;
    }
  }

  return state;
}

function isTopLevelPipe(s: string, i: number): boolean {
  if (s[i] !== '|') return false;
  const st = scanDelimitersUpTo(s, i);
  return (
    st.paren === 0 &&
    st.bracket === 0 &&
    st.brace === 0 &&
    st.angle === 0 &&
    st.inString === 'none'
  );
}

/**
 * Split a type string on top-level `|` union separators.
 * Returns null if there is no union or split would be unsafe.
 */
export function splitTopLevelUnionParts(input: string): string[] | null {
  const s = input.trim();
  if (s.length === 0) return null;

  const parts: string[] = [];
  let start = 0;

  for (let i = 0; i < s.length; i++) {
    if (isTopLevelPipe(s, i)) {
      const chunk = s.slice(start, i).trim();
      if (chunk.length > 0) parts.push(chunk);
      start = i + 1;
    }
  }

  const last = s.slice(start).trim();
  if (last.length > 0) parts.push(last);

  if (parts.length < 2) return null;
  return parts;
}

function isBalancedBraces(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const st = scanDelimitersUpTo(s, i);
    if (st.inString !== 'none') continue;
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Pretty-print a `{ ... }` object type with indented lines.
 */
export function prettyPrintObjectLikeType(input: string): string | null {
  const s = input.trim();
  if (s.length === 0 || !s.startsWith('{') || !s.endsWith('}')) return null;
  if (!isBalancedBraces(s)) return null;

  let out = '';
  let i = 0;
  let indent = 0;
  const indentUnit = '  ';
  const lineIndent = () => '\n' + indentUnit.repeat(Math.max(0, indent));

  while (i < s.length) {
    const c = s[i];
    const st = scanDelimitersUpTo(s, i);

    if (st.inString !== 'none') {
      out += c ?? '';
      i++;
      continue;
    }

    if (c === '{') {
      out += '{';
      i++;
      const next = skipWs(s, i);
      if (next < s.length && s[next] !== '}') {
        indent++;
        out += lineIndent();
      }
      continue;
    }

    if (c === '}') {
      const stBefore = scanDelimitersUpTo(s, i);
      const innerBrace = stBefore.brace;
      if (innerBrace > 0) {
        indent = Math.max(0, indent - 1);
        if (!out.endsWith('\n')) out += lineIndent();
      }
      out += '}';
      i++;
      continue;
    }

    if (c === ';') {
      out += ';';
      i++;
      const next = skipWs(s, i);
      if (next < s.length && s[next] !== '}') {
        out += lineIndent();
      }
      continue;
    }

    if (c === ',') {
      const stComma = scanDelimitersUpTo(s, i);
      const atObjPropLevel =
        stComma.paren === 0 && stComma.bracket === 0 && stComma.brace === 1 && stComma.angle === 0;
      out += ',';
      i++;
      if (atObjPropLevel) {
        const next = skipWs(s, i);
        if (next < s.length && s[next] !== '}') {
          out += lineIndent();
        }
      }
      continue;
    }

    out += c ?? '';
    i++;
  }

  return out.trim();
}

function tryObjectBlock(raw: string): string | null {
  const t = raw.trim();
  if (t.length < 2 || !t.startsWith('{') || !t.endsWith('}')) return null;
  const pretty = prettyPrintObjectLikeType(t);
  if (!pretty) return null;
  if (!pretty.includes('\n') && t.length > 48) {
    return pretty;
  }
  return pretty.includes('\n') ? pretty : null;
}

/**
 * Build a display model for a flattened type annotation string.
 */
export function buildTypeDisplayModel(input: string): TypeDisplayModel {
  const raw = input.trim();
  if (raw.length === 0) {
    return { kind: 'plain', raw: input };
  }

  const unionParts = splitTopLevelUnionParts(raw);
  if (unionParts) {
    const members = unionParts.map((p) => p.trim()).filter(Boolean);
    if (members.length >= 2) {
      return { kind: 'unionRows', raw, unionMembers: members };
    }
  }

  const block = tryObjectBlock(raw);
  if (block) {
    return { kind: 'objectBlock', raw, objectBlock: block };
  }

  return { kind: 'plain', raw };
}

/**
 * Format an arbitrary detail string (entity detail, metadata) using the same rules.
 */
export function buildDetailDisplayModel(detail: string): TypeDisplayModel {
  const trimmed = detail.trim();
  if (trimmed.startsWith('():')) {
    const rest = trimmed.slice(3).trim();
    const inner = buildTypeDisplayModel(rest);
    if (inner.kind === 'plain') {
      return { kind: 'plain', raw: detail };
    }
    if (inner.kind === 'unionRows' && inner.unionMembers) {
      return {
        kind: 'unionRows',
        raw: detail,
        unionMembers: inner.unionMembers.map((m) => `(): ${m}`),
      };
    }
    if (inner.kind === 'objectBlock' && inner.objectBlock) {
      return { kind: 'objectBlock', raw: detail, objectBlock: `(): ${inner.objectBlock}` };
    }
  }
  return buildTypeDisplayModel(detail);
}
