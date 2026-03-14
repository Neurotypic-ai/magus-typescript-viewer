import type { ASTNode, ASTPath, Identifier, JSCodeshift, JSXIdentifier, TSTypeAnnotation, TSTypeParameter } from 'jscodeshift';
import type { Logger } from '../../../shared/utils/logger';
import type { SymbolUsageRef } from '../ParseResult';

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
    if (expression) {
      if (expression.type === 'Identifier' && 'name' in expression) {
        return expression.name;
      }
      // TSQualifiedName: e.g. ns.Bar — Babel AST uses this for type-position qualified names
      if (expression.type === 'TSQualifiedName' && 'right' in expression) {
        const right = expression.right as ASTNode;
        if ('name' in right && typeof right.name === 'string') {
          return right.name;
        }
      }
      // MemberExpression: e.g. module.Parent or a.b.c.Parent (value-position)
      if (expression.type === 'MemberExpression' && 'property' in expression) {
        const property = expression.property as ASTNode;
        if (property.type === 'Identifier' && 'name' in property) {
          return property.name;
        }
      }
    }
  }
  // Direct Identifier
  if (node.type === 'Identifier' && 'name' in node) {
    return node.name;
  }
  // Direct TSQualifiedName (without TSExpressionWithTypeArguments wrapper)
  if (node.type === 'TSQualifiedName' && 'right' in node) {
    const right = node.right as ASTNode;
    if ('name' in right && typeof right.name === 'string') {
      return right.name;
    }
  }
  // Direct MemberExpression (without TSExpressionWithTypeArguments wrapper)
  if (node.type === 'MemberExpression' && 'property' in node) {
    const property = node.property as ASTNode;
    if (property.type === 'Identifier' && 'name' in property) {
      return property.name;
    }
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

/**
 * Extract symbol usages (member expressions) from an AST node.
 * Captures property accesses and method calls for later resolution.
 *
 * NOTE: The `context` parameter here is the source symbol info object
 * (moduleId, sourceSymbolId, etc.), NOT a ModuleParserContext.
 */
export function extractSymbolUsages(
  j: JSCodeshift,
  node: ASTNode,
  context: {
    moduleId: string;
    sourceSymbolId?: string | undefined;
    sourceSymbolType: 'method' | 'function';
    sourceSymbolName?: string | undefined;
    sourceParentName?: string | undefined;
    sourceParentType?: 'class' | 'interface' | undefined;
  }
): SymbolUsageRef[] {
  const usages: SymbolUsageRef[] = [];
  const seen = new Set<string>();

  j(node)
    .find(j.MemberExpression)
    .forEach((memberPath: ASTPath) => {
      const member = memberPath.node;
      if (member.type !== 'MemberExpression') return;

      let targetName: string | undefined;
      if (member.property.type === 'Identifier') {
        targetName = member.property.name;
      } else if ('value' in member.property && typeof member.property.value === 'string') {
        targetName = member.property.value;
      }
      if (!targetName) return;

      let qualifierName: string | undefined;
      if (member.object.type === 'Identifier') {
        qualifierName = member.object.name;
      } else if (member.object.type === 'ThisExpression') {
        qualifierName = 'this';
      }

      const isMethodCall = memberPath.name === 'callee';
      const targetKind = isMethodCall ? 'method' : 'property';

      const dedupeKey = `${targetKind}|${qualifierName ?? ''}|${targetName}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      usages.push({
        moduleId: context.moduleId,
        sourceSymbolId: context.sourceSymbolId,
        sourceSymbolType: context.sourceSymbolType,
        sourceSymbolName: context.sourceSymbolName,
        sourceParentName: context.sourceParentName,
        sourceParentType: context.sourceParentType,
        targetName,
        targetKind,
        qualifierName,
      });
    });

  return usages;
}

/**
 * Extract decorator names from a node's `decorators` array.
 * Decorators are typically `Identifier` nodes or `CallExpression` with `Identifier` callee.
 * Returns an array of decorator name strings.
 */
export function extractDecoratorNames(node: ASTNode): string[] {
  if (!('decorators' in node) || !Array.isArray(node.decorators)) {
    return [];
  }

  const names: string[] = [];
  for (const decorator of node.decorators as ASTNode[]) {
    if (!('expression' in decorator)) continue;
    const expr = decorator.expression as ASTNode;

    if (expr.type === 'Identifier' && 'name' in expr) {
      names.push(expr.name);
    } else if (expr.type === 'CallExpression' && 'callee' in expr) {
      const callee = expr.callee as ASTNode;
      if (callee.type === 'Identifier' && 'name' in callee) {
        names.push(callee.name);
      }
    }
  }

  return names;
}
