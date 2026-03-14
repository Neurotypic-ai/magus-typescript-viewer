import { getTypeFromAnnotation, extractSymbolUsages } from './astUtils';
import { generateMethodUUID, generateParameterUUID, generatePropertyUUID } from '../../utils/uuid';

import type { ModuleParserContext } from './types';
import type { ParseResult } from '../ParseResult';
import type { IMethodCreateDTO } from '../../db/repositories/MethodRepository';
import type { IPropertyCreateDTO } from '../../db/repositories/PropertyRepository';
import type { IParameterCreateDTO } from '../../db/repositories/ParameterRepository';
import type {
  ASTNode,
  ASTPath,
  ClassDeclaration,
  ClassProperty,
  Collection,
  MethodDefinition,
  TSInterfaceDeclaration,
  TSMethodSignature,
  TSPropertySignature,
  TSTypeAnnotation,
} from 'jscodeshift';
import type { Logger } from '../../../shared/utils/logger';

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Parse methods from a class or interface node collection.
 * Handles regular method definitions, arrow-function class properties,
 * interface method signatures, and function-typed interface properties.
 */
export function parseMethods(
  ctx: ModuleParserContext,
  collection: Collection,
  parentType: 'class' | 'interface',
  parentId: string,
  result: ParseResult,
  parentName?: string
): IMethodCreateDTO[] {
  const methods: IMethodCreateDTO[] = [];
  const moduleId = ctx.moduleId;

  try {
    // Expand method node collection to include more patterns
    let methodNodes: Collection;

    if (parentType === 'class') {
      // Get method definitions
      const classMethods = collection.find(ctx.j.MethodDefinition);

      // Add class property arrow functions
      const propertyMethods = collection
        .find(ctx.j.ClassProperty)
        .filter((path: ASTPath<ClassProperty>): boolean => {
          const value = path.value.value;
          const hasArrowFunction = Boolean(
            value && typeof value === 'object' && 'type' in value && value.type === 'ArrowFunctionExpression'
          );

          // Also check for function type annotations
          const hasFunctionType = isFunctionTypeProperty(path.value, ctx.logger);

          return hasArrowFunction || hasFunctionType;
        });

      // Combine both collections
      methodNodes = ctx.j([...classMethods.paths(), ...propertyMethods.paths()]);
    } else {
      // Interface methods - include both method signatures and function-typed properties
      const interfaceMethods = collection.find(ctx.j.TSMethodSignature);

      const functionTypedProps = collection.find(ctx.j.TSPropertySignature).filter((path): boolean => {
        return isFunctionTypeProperty(path.value, ctx.logger);
      });

      // Combine both collections
      methodNodes = ctx.j([...interfaceMethods.paths(), ...functionTypedProps.paths()]);
    }

    methodNodes.forEach((path) => {
      try {
        const node = path.value as MethodDefinition | TSMethodSignature | ClassProperty | TSPropertySignature;
        const methodName = getMethodName(node, ctx.logger);

        if (!methodName) {
          ctx.logger.info('Skipping method with invalid name', {
            parentId,
            nodeType: node.type,
          });
          return;
        }

        const methodId = generateMethodUUID(ctx.packageId, moduleId, parentId, methodName);
        const hasExplicitReturnType = getReturnTypeNode(node) != null;
        const returnType = getReturnType(ctx, node);

        // Parse parameters and store them in the result object
        const parameters = parseParameters(ctx, node, methodId, moduleId);

        // Add static detection with type guard
        const isStatic = parentType === 'class' && 'static' in node && node.static;

        // Detect abstract methods (e.g., abstract class members)
        const isAbstract = 'abstract' in node && (node as unknown as Record<string, unknown>)['abstract'] === true;

        // Detect visibility from jscodeshift's `accessibility` property
        const visibility: string = (() => {
          if ('accessibility' in node && typeof (node as unknown as Record<string, unknown>)['accessibility'] === 'string') {
            return (node as unknown as Record<string, unknown>)['accessibility'] as string;
          }
          return 'public';
        })();

        // Add async detection with type guard
        // Check for async on the node itself (MethodDefinition, TSMethodSignature)
        // and on the inner function value (FunctionExpression, ArrowFunctionExpression)
        const isAsync = (() => {
          const nodeRec = node as unknown as Record<string, unknown>;
          // Check async property directly on the node (e.g., MethodDefinition.async)
          if ('async' in node && nodeRec['async'] === true) {
            return true;
          }
          // Check async on the inner function value (FunctionExpression or ArrowFunctionExpression)
          if ('value' in node && node.value !== null && typeof node.value === 'object') {
            const value = node.value as unknown as Record<string, unknown>;
            if (
              (value['type'] === 'FunctionExpression' || value['type'] === 'ArrowFunctionExpression') &&
              value['async'] === true
            ) {
              return true;
            }
          }
          return false;
        })();

        // TODO: Decorator extraction would go here — no schema field exists yet for decorators on methods.
        // When a `decorators` column is added, use: extractDecoratorNames(node) from astUtils.ts

        methods.push({
          id: methodId,
          name: methodName,
          package_id: ctx.packageId,
          module_id: moduleId,
          parent_id: parentId,
          parent_type: parentType,
          return_type: returnType,
          is_static: isStatic,
          is_abstract: isAbstract,
          is_async: isAsync,
          visibility,
          has_explicit_return_type: hasExplicitReturnType,
        });

        const usages = extractSymbolUsages(ctx.j, node, {
          moduleId,
          sourceSymbolId: methodId,
          sourceSymbolType: 'method',
          sourceSymbolName: methodName,
          sourceParentName: parentName,
          sourceParentType: parentType,
        });
        if (usages.length > 0) {
          result.symbolUsages.push(...usages);
        }

        // Add parameters to the result object
        if (parameters.length > 0) {
          result.parameters.push(...parameters);
        }
      } catch (error) {
        ctx.logger.error('Error parsing individual method:', { error, parentId });
      }
    });
  } catch (error) {
    ctx.logger.error('Error parsing methods:', { error, parentId });
  }

  return methods;
}

/**
 * Parse non-function-typed properties from a class or interface node.
 * Properties that have function type annotations are skipped here
 * (they are handled as methods by `parseMethods`).
 */
export function parseProperties(
  ctx: ModuleParserContext,
  moduleId: string,
  parentId: string,
  parentType: 'class' | 'interface',
  node: ClassDeclaration | TSInterfaceDeclaration
): IPropertyCreateDTO[] {
  const properties: IPropertyCreateDTO[] = [];
  const collection = ctx.j(node);
  const propertyNodes =
    parentType === 'class' ? collection.find(ctx.j.ClassProperty) : collection.find(ctx.j.TSPropertySignature);

  const propertyNameCounts = new Map<string, number>();

  propertyNodes.forEach((path) => {
    try {
      const propertyNode = path.node;
      const propertyName = getPropertyName(propertyNode, ctx.logger);
      if (!propertyName) {
        ctx.logger.error('Invalid property name');
        return;
      }

      // Check if this property has a function type annotation
      const isFnType = isFunctionTypeProperty(propertyNode, ctx.logger);
      if (isFnType) {
        // Skip function-typed properties - they should be handled as methods
        ctx.logger.debug(`Skipping function-typed property: ${propertyName}`);
        return;
      }

      const propertyType = getTypeFromAnnotation(ctx.j, propertyNode.typeAnnotation as TSTypeAnnotation, ctx.logger);

      // Track seen property names and disambiguate only on collision
      const seenCount = propertyNameCounts.get(propertyName) ?? 0;
      propertyNameCounts.set(propertyName, seenCount + 1);
      const propertyKey = seenCount === 0 ? propertyName : `${propertyName}_${String(seenCount)}`;

      // Generate a deterministic property ID using package, module, parent, and property name
      const propertyId = generatePropertyUUID(
        ctx.packageId,
        moduleId,
        parentId,
        propertyKey,
        parentType
      );

      // Detect static, readonly, and visibility from the AST node
      const isStatic = 'static' in propertyNode && (propertyNode as unknown as Record<string, unknown>)['static'] === true;
      const isReadonly = 'readonly' in propertyNode && (propertyNode as unknown as Record<string, unknown>)['readonly'] === true;
      const visibility: string = (() => {
        if ('accessibility' in propertyNode && typeof (propertyNode as unknown as Record<string, unknown>)['accessibility'] === 'string') {
          return (propertyNode as unknown as Record<string, unknown>)['accessibility'] as string;
        }
        return 'public';
      })();

      // TODO: Decorator extraction would go here — no schema field exists yet for decorators on properties.
      // When a `decorators` column is added, use: extractDecoratorNames(propertyNode) from astUtils.ts

      properties.push({
        id: propertyId,
        module_id: moduleId,
        parent_id: parentId,
        parent_type: parentType,
        name: propertyName,
        type: propertyType,
        package_id: ctx.packageId,
        is_static: isStatic,
        is_readonly: isReadonly,
        visibility,
      });
    } catch (error: unknown) {
      ctx.logger.error(`Error parsing property: ${String(error)}`);
    }
  });

  return properties;
}

// ---------------------------------------------------------------------------
// File-private helper functions (NOT exported)
// ---------------------------------------------------------------------------

/**
 * Parse parameters from a method-like node.
 */
function parseParameters(
  ctx: ModuleParserContext,
  node: MethodDefinition | TSMethodSignature | ClassProperty | TSPropertySignature,
  methodId: string,
  moduleId: string
): IParameterCreateDTO[] {
  const parameters: IParameterCreateDTO[] = [];

  try {
    const params = getParametersList(node);
    if (!Array.isArray(params)) {
      return parameters;
    }

    for (const param of params) {
      let paramName: string;
      let paramTypeAnnotation: TSTypeAnnotation | undefined;
      let isRest = false;
      let isOptional = false;

      if (param.type === 'Identifier') {
        paramName = param.name;
        paramTypeAnnotation = param.typeAnnotation as TSTypeAnnotation | undefined;
        isOptional = Boolean(param.optional);
      } else if (param.type === 'RestElement') {
        // ...rest: string[]
        isRest = true;
        if (param.argument?.type === 'Identifier') {
          paramName = param.argument.name;
        } else {
          paramName = '...rest';
        }
        paramTypeAnnotation = param.typeAnnotation as TSTypeAnnotation | undefined;
      } else if (param.type === 'AssignmentPattern') {
        // x = defaultVal
        if (param.left?.type === 'Identifier') {
          paramName = param.left.name;
          paramTypeAnnotation = param.left.typeAnnotation as TSTypeAnnotation | undefined;
        } else {
          paramName = '{destructured}';
          paramTypeAnnotation = undefined;
          ctx.logger.debug(`Parameter with AssignmentPattern has non-Identifier left side, using placeholder name`);
        }
        isOptional = true; // Parameters with defaults are effectively optional
      } else if (param.type === 'ObjectPattern') {
        // { x, y }: Point
        paramName = '{destructured}';
        paramTypeAnnotation = param.typeAnnotation as TSTypeAnnotation | undefined;
      } else if (param.type === 'ArrayPattern') {
        // [a, b]: number[]
        paramName = '[destructured]';
        // ArrayPattern may not have typeAnnotation directly; access via index signature
        const arrayParam = param as unknown as Record<string, unknown>;
        paramTypeAnnotation = (arrayParam['typeAnnotation'] as TSTypeAnnotation | undefined) ?? undefined;
      } else {
        ctx.logger.debug(`Skipping unsupported parameter type: ${param.type}`);
        continue;
      }

      const paramType = getTypeFromAnnotation(ctx.j, paramTypeAnnotation as TSTypeAnnotation, ctx.logger);
      const paramId = generateParameterUUID(methodId, paramName);

      parameters.push({
        id: paramId,
        name: paramName,
        type: paramType,
        package_id: ctx.packageId,
        module_id: moduleId,
        method_id: methodId,
        is_optional: isOptional,
        is_rest: isRest,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.logger.error(`Error parsing parameters: ${errorMessage}`);
  }

  return parameters;
}

/**
 * Extract the parameters list from a method-like node.
 * Handles MethodDefinition, ClassProperty (arrow functions), TSMethodSignature,
 * and TSPropertySignature (function-typed properties).
 */
function getParametersList(
  node: MethodDefinition | TSMethodSignature | ClassProperty | TSPropertySignature
): ASTNode[] {
  if ('value' in node && node.value) {
    // For ClassProperty with arrow function or MethodDefinition
    if ('params' in node.value) {
      return node.value.params;
    }
  }
  if ('parameters' in node) {
    // For TSMethodSignature
    return node.parameters;
  }
  // For function-typed properties, try to extract params from type annotation
  if ('typeAnnotation' in node && node.typeAnnotation?.type === 'TSTypeAnnotation') {
    const typeAnnotation = node.typeAnnotation.typeAnnotation;
    if ('parameters' in typeAnnotation && Array.isArray(typeAnnotation.parameters)) {
      return typeAnnotation.parameters;
    }
  }
  return [];
}

/**
 * Get the return type string for a method-like node.
 * Falls back to 'void' when no annotation is present or on error.
 */
function getReturnType(
  ctx: ModuleParserContext,
  node: MethodDefinition | TSMethodSignature | ClassProperty | TSPropertySignature
): string {
  try {
    const returnTypeNode = getReturnTypeNode(node);
    return getTypeFromAnnotation(ctx.j, returnTypeNode, ctx.logger) || 'void';
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.logger.error(`Error getting return type: ${errorMessage}`);
    return 'void';
  }
}

/**
 * Extract the return type annotation node from a method-like node.
 */
function getReturnTypeNode(
  node: MethodDefinition | TSMethodSignature | ClassProperty | TSPropertySignature
): TSTypeAnnotation | undefined {
  if ('value' in node && node.value) {
    // For MethodDefinition and ClassProperty with arrow functions
    if ('returnType' in node.value && node.value.returnType) {
      return node.value.returnType as TSTypeAnnotation;
    }
  }
  if ('typeAnnotation' in node && node.typeAnnotation) {
    // For TSMethodSignature and TSPropertySignature with function types
    return node.typeAnnotation as TSTypeAnnotation;
  }
  return undefined;
}

/**
 * Get the name of a method-like node from its key.
 */
function getMethodName(
  node: MethodDefinition | TSMethodSignature | ClassProperty | TSPropertySignature,
  logger: Logger
): string | undefined {
  try {
    if (node.key.type === 'Identifier') {
      return node.key.name;
    }
    const key = node.key as unknown as Record<string, unknown>;
    // String literal keys: 'method-name' or "method-name"
    if (node.key.type === 'StringLiteral' || (node.key.type === 'Literal' && typeof key['value'] === 'string')) {
      return key['value'] as string;
    }
    // Numeric literal keys: 0, 1, etc.
    if (node.key.type === 'NumericLiteral' || (node.key.type === 'Literal' && typeof key['value'] === 'number')) {
      return String(key['value']);
    }
    return undefined;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Error getting method name:', { error: errorMessage });
    return undefined;
  }
}

/**
 * Get the name of a property node from its key.
 */
function getPropertyName(node: ClassProperty | TSPropertySignature, logger: Logger): string | undefined {
  try {
    if (node.key.type === 'Identifier') {
      return node.key.name;
    }
    const key = node.key as unknown as Record<string, unknown>;
    // String literal keys: 'prop-name' or "prop-name"
    if (node.key.type === 'StringLiteral' || (node.key.type === 'Literal' && typeof key['value'] === 'string')) {
      return key['value'] as string;
    }
    // Numeric literal keys: 0, 1, etc.
    if (node.key.type === 'NumericLiteral' || (node.key.type === 'Literal' && typeof key['value'] === 'number')) {
      return String(key['value']);
    }
    return undefined;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Error getting property name:', { error: errorMessage });
    return undefined;
  }
}

/**
 * Check if a property has a function type annotation (TSFunctionType,
 * TSConstructorType, or is an arrow function expression).
 */
function isFunctionTypeProperty(node: ClassProperty | TSPropertySignature, logger: Logger): boolean {
  try {
    if (node.typeAnnotation?.type !== 'TSTypeAnnotation') {
      return false;
    }

    const typeAnnotation = node.typeAnnotation.typeAnnotation;

    // Check for function type annotation
    return (
      typeAnnotation.type === 'TSFunctionType' ||
      typeAnnotation.type === 'TSConstructorType' ||
      // Also check for arrow function values
      ('value' in node && node.value?.type === 'ArrowFunctionExpression')
    );
  } catch (error) {
    logger.error('Error checking function type:', { error });
    return false;
  }
}

