import type { ASTNode, Identifier, JSCodeshift, JSXIdentifier, TSTypeAnnotation, TSTypeParameter } from 'jscodeshift';
import type { Logger } from '../../../shared/utils/logger';

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
  logger: Logger
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
export function getReturnTypeFromNode(j: JSCodeshift, node: ASTNode, logger: Logger): string {
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
