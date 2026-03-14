import type { ASTNode } from 'jscodeshift';

/**
 * Represents a single parsed JSDoc @param tag.
 */
export interface JsDocParam {
  name: string;
  type?: string;
  description?: string;
}

/**
 * Represents a parsed JSDoc @returns tag.
 */
export interface JsDocReturns {
  type?: string;
  description?: string;
}

/**
 * Represents a catch-all for unrecognized JSDoc tags.
 */
export interface JsDocTag {
  tag: string;
  value: string;
}

/**
 * Structured representation of all extracted JSDoc/TSDoc tags from a comment block.
 */
export interface JsDocTags {
  description?: string;
  params?: JsDocParam[];
  returns?: JsDocReturns;
  deprecated?: string | true;
  example?: string[];
  tags?: JsDocTag[];
}

/**
 * Comment node shape as found on jscodeshift AST nodes.
 * jscodeshift stores comments as arrays of objects with `type` and `value`.
 */
interface CommentNode {
  type: string;
  value: string;
  leading?: boolean;
}

/**
 * Checks whether an AST node has a leading JSDoc block comment.
 * JSDoc comments are Block comments (delimited by slash-star-star ... star-slash).
 */
function getLeadingBlockComment(node: ASTNode): string | undefined {
  // jscodeshift attaches comments in `leadingComments` or `comments` arrays
  const comments: CommentNode[] | undefined =
    (node as unknown as { leadingComments?: CommentNode[] }).leadingComments ??
    (node as unknown as { comments?: CommentNode[] }).comments;

  if (!comments || comments.length === 0) {
    return undefined;
  }

  // Find the last leading Block comment that looks like JSDoc (starts with *)
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    if (comment.type === 'Block' || comment.type === 'CommentBlock') {
      // JSDoc comments start with a second asterisk: /** ... */
      // The value stored by the parser excludes the outer /* and */,
      // so a JSDoc comment value starts with *
      const value = comment.value;
      if (value.startsWith('*')) {
        return value;
      }
    }
  }

  return undefined;
}

/**
 * Clean a raw JSDoc comment value by removing leading asterisks and whitespace
 * from each line, then trimming the result.
 *
 * Input is the raw value between the comment delimiters (without the opening
 * slash-star and closing star-slash). For JSDoc, this starts with a `*`.
 */
function cleanCommentText(raw: string): string {
  return raw
    .split('\n')
    .map((line) => {
      // Remove leading whitespace, then an optional leading `*`, then one optional space
      return line.replace(/^\s*\*? ?/, '');
    })
    .join('\n')
    .trim();
}

/**
 * Extract the leading JSDoc comment from an AST node.
 * Returns the cleaned comment text (without star prefixes and comment delimiters).
 * Returns undefined if no JSDoc comment is found.
 *
 * Only block comments (JSDoc/TSDoc style) are considered.
 * Line comments are ignored.
 */
export function extractJsDoc(node: ASTNode): string | undefined {
  const raw = getLeadingBlockComment(node);
  if (raw === undefined) {
    return undefined;
  }

  const cleaned = cleanCommentText(raw);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Parse a `@param` tag line (and potential continuation lines).
 *
 * Formats handled:
 *   @param {string} name - Description
 *   @param name Description
 *   @param name - Description
 */
function parseParamTag(value: string): JsDocParam {
  // Try: @param {Type} name - description
  const withType = /^\{([^}]+)\}\s+(\S+)(?:\s+-?\s*(.*))?$/.exec(value);
  if (withType) {
    const result: JsDocParam = { name: withType[2], type: withType[1] };
    if (withType[3]) {
      result.description = withType[3].trim();
    }
    return result;
  }

  // Try: @param name - description  OR  @param name description
  const withoutType = /^(\S+)(?:\s+-?\s*(.*))?$/.exec(value);
  if (withoutType) {
    const result: JsDocParam = { name: withoutType[1] };
    if (withoutType[2]) {
      result.description = withoutType[2].trim();
    }
    return result;
  }

  return { name: value.trim() };
}

/**
 * Parse a `@returns` / `@return` tag value.
 *
 * Formats handled:
 *   @returns {Type} Description
 *   @returns Description
 */
function parseReturnsTag(value: string): JsDocReturns {
  const withType = /^\{([^}]+)\}\s*(.*)$/.exec(value);
  if (withType) {
    const result: JsDocReturns = { type: withType[1] };
    if (withType[2].trim()) {
      result.description = withType[2].trim();
    }
    return result;
  }

  return { description: value.trim() || undefined };
}

/**
 * Extract specific JSDoc tags from the leading comment of an AST node.
 * Returns a structured object with parsed description, params, returns,
 * deprecated status, examples, and any other tags.
 *
 * Returns an empty object if no JSDoc comment is found.
 */
export function extractJsDocTags(node: ASTNode): JsDocTags {
  const raw = getLeadingBlockComment(node);
  if (raw === undefined) {
    return {};
  }

  const cleaned = cleanCommentText(raw);
  if (cleaned.length === 0) {
    return {};
  }

  const result: JsDocTags = {};

  // Split into description (before first @tag) and tags
  const lines = cleaned.split('\n');
  const descriptionLines: string[] = [];
  const tagEntries: { tag: string; value: string }[] = [];

  let currentTag: { tag: string; lines: string[] } | null = null;

  for (const line of lines) {
    const tagMatch = /^@(\w+)\s*(.*)$/.exec(line);
    if (tagMatch) {
      // Flush previous tag
      if (currentTag) {
        tagEntries.push({ tag: currentTag.tag, value: currentTag.lines.join('\n').trim() });
      }
      currentTag = { tag: tagMatch[1], lines: tagMatch[2] ? [tagMatch[2]] : [] };
    } else if (currentTag) {
      // Continuation line for current tag
      currentTag.lines.push(line);
    } else {
      // Part of description (before any tags)
      descriptionLines.push(line);
    }
  }

  // Flush last tag
  if (currentTag) {
    tagEntries.push({ tag: currentTag.tag, value: currentTag.lines.join('\n').trim() });
  }

  // Set description
  const description = descriptionLines.join('\n').trim();
  if (description) {
    result.description = description;
  }

  // Process known tags
  const otherTags: JsDocTag[] = [];

  for (const entry of tagEntries) {
    switch (entry.tag) {
      case 'param':
        result.params ??= [];
        result.params.push(parseParamTag(entry.value));
        break;

      case 'returns':
      case 'return':
        result.returns = parseReturnsTag(entry.value);
        break;

      case 'deprecated':
        result.deprecated = entry.value.length > 0 ? entry.value : true;
        break;

      case 'example':
        result.example ??= [];
        result.example.push(entry.value);
        break;

      default:
        otherTags.push({ tag: entry.tag, value: entry.value });
        break;
    }
  }

  if (otherTags.length > 0) {
    result.tags = otherTags;
  }

  return result;
}
