import type { ConsolaInstance } from 'consola';
import type { ASTNode, Identifier, JSCodeshift, JSXIdentifier, TSTypeAnnotation, TSTypeParameter } from 'jscodeshift';

/**
 * Line range (1-indexed) extracted from a jscodeshift AST node's `.loc` property.
 * Both fields are undefined when the node has no source location (e.g., synthesized nodes).
 */
interface AstLineRange {
  start_line?: number;
  end_line?: number;
}

/**
 * Extract 1-indexed start/end lines from any AST node's `loc` property. Safe on
 * nodes without locations (returns empty object); never throws.
 */
export function getNodeLineRange(node: ASTNode | null | undefined): AstLineRange {
  if (!node) return {};
  // jscodeshift nodes carry `loc: {start: {line, column}, end: {line, column}}`
  // when parsed from source. Some synthesized nodes lack it.
  const loc = (node as { loc?: { start?: { line?: number }; end?: { line?: number } } }).loc;
  if (!loc) return {};
  const range: AstLineRange = {};
  if (typeof loc.start?.line === 'number') range.start_line = loc.start.line;
  if (typeof loc.end?.line === 'number') range.end_line = loc.end.line;
  return range;
}

/**
 * Detect whether a node has a leading JSDoc-style block comment (starts with `*`).
 * JSDoc identification without a full parser: block comment whose text begins with
 * an asterisk (i.e., `/** ... *​/`). Returns false on any access failure.
 */
export function hasJsDocComment(node: ASTNode | null | undefined): boolean {
  if (!node) return false;
  const comments = (node as { leadingComments?: { type?: string; value?: string }[] }).leadingComments;
  if (!Array.isArray(comments)) return false;
  return comments.some((c) => {
    const type = c.type ?? '';
    const value = c.value ?? '';
    return (type === 'CommentBlock' || type === 'Block') && value.startsWith('*');
  });
}

/**
 * Safely get identifier name to work around type issues.
 */
export function getIdentifierName(id: string | Identifier | JSXIdentifier | TSTypeParameter): string | null {
  if (!id) return null;
  if (typeof id === 'string') return id;

  // Use type safe way to access name property
  if ('name' in id && typeof id.name === 'string') {
    return id.name;
  }

  return null;
}

/**
 * Extracts the name from a heritage clause node (implements/extends).
 * Handles both TSExpressionWithTypeArguments (has `expression`) and direct Identifiers.
 */
export function getHeritageClauseName(node: ASTNode): string | null {
  // TSExpressionWithTypeArguments has an `expression` property
  if ('expression' in node) {
    const expression = node.expression as ASTNode | undefined;
    if (expression?.type === 'Identifier' && 'name' in expression) {
      return expression.name;
    }
  }
  // Direct Identifier
  if (node.type === 'Identifier' && 'name' in node) {
    return node.name;
  }
  return null;
}

/**
 * Extract the source text of a type annotation, collapsing whitespace.
 * Returns 'any' if the annotation is missing or cannot be serialized.
 */
export function getTypeFromAnnotation(
  j: JSCodeshift,
  annotation: TSTypeAnnotation | null | undefined,
  logger: ConsolaInstance
): string {
  if (!annotation) {
    return 'any';
  }

  try {
    return (
      j(annotation)
        .toSource()
        .replace(/[\n\s]+/g, ' ')
        .trim() || 'any'
    );
  } catch (error: unknown) {
    logger.error('Error getting type from annotation:', { error: String(error) });
    return 'any';
  }
}

/**
 * Get return type from a function-like AST node.
 * Returns 'void' if no explicit return type annotation is present.
 */
export function getReturnTypeFromNode(j: JSCodeshift, node: ASTNode, logger: ConsolaInstance): string {
  try {
    if ('returnType' in node && node.returnType) {
      const returnType = node.returnType as TSTypeAnnotation;
      return getTypeFromAnnotation(j, returnType, logger);
    }
  } catch (error) {
    logger.error('Error getting return type:', error);
  }
  return 'void';
}
