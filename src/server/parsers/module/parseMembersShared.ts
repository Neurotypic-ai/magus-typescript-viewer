import { getErrorMessage } from '../../../shared/utils/errorUtils';
import { getTypeFromAnnotation, extractSymbolUsages } from './astUtils';
import { getNodeProp } from '../utils/astNodeAccess';
import { buildTypeReference, extractTypeNames } from '../utils/extractTypeReferences';
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
  ClassMethod,
  ClassProperty,
  Collection,
  MethodDefinition,
  TSDeclareMethod,
  TSInterfaceDeclaration,
  TSMethodSignature,
  TSPropertySignature,
  TSTypeAnnotation,
} from 'jscodeshift';

type MethodLikeNode = MethodDefinition | ClassMethod | TSDeclareMethod | TSMethodSignature | ClassProperty | TSPropertySignature;
import type { Logger } from '../../../shared/utils/logger';

// ---------------------------------------------------------------------------
// Shared property-access helpers (reduce repeated `as unknown as Record`)
// ---------------------------------------------------------------------------

/** Read a boolean-valued property from an AST node. */
function getBooleanProp(node: ASTNode, prop: string): boolean {
  return getNodeProp(node, prop) === true;
}

/** Read the `accessibility` property, defaulting to `'public'`. */
function getVisibility(node: ASTNode): string {
  const accessibility = getNodeProp(node, 'accessibility');
  return typeof accessibility === 'string' ? accessibility : 'public';
}

/** Detect whether a method node (or its inner function value) is async. */
function isAsyncMethod(node: ASTNode): boolean {
  if (getNodeProp(node, 'async') === true) return true;
  const value = getNodeProp(node, 'value');
  if (value !== null && typeof value === 'object') {
    return (getNodeProp(value, 'type') === 'FunctionExpression' || getNodeProp(value, 'type') === 'ArrowFunctionExpression') && getNodeProp(value, 'async') === true;
  }
  return false;
}

function appendTypeReferences(
  result: ParseResult,
  typeExpression: string | undefined,
  context: 'property_type' | 'parameter_type' | 'return_type',
  sourceId: string,
  sourceKind: 'property' | 'method' | 'parameter'
): void {
  if (!typeExpression) {
    return;
  }

  const typeNames = extractTypeNames(typeExpression);
  if (typeNames.length === 0) {
    return;
  }

  result.typeReferences ??= [];

  result.typeReferences.push(
    ...typeNames.map((typeName) => buildTypeReference(typeName, context, sourceId, sourceKind))
  );
}

/** Extract a name from a node's `key` (Identifier, StringLiteral, NumericLiteral, Literal). */
function getNodeKeyName(node: { key: ASTNode }, logger: Logger): string | undefined {
  try {
    if (node.key.type === 'Identifier') return node.key.name;
    const keyValue = getNodeProp(node.key, 'value');
    if (node.key.type === 'StringLiteral' || (node.key.type === 'Literal' && typeof keyValue === 'string')) {
      return keyValue as string;
    }
    if (node.key.type === 'NumericLiteral' || (node.key.type === 'Literal' && typeof keyValue === 'number')) {
      return String(keyValue);
    }
    return undefined;
  } catch (error) {
    logger.error('Error getting node key name:', { error: getErrorMessage(error) });
    return undefined;
  }
}

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
      // Babel/tsx parser produces ClassMethod; ESTree uses MethodDefinition.
      // Abstract methods are TSDeclareMethod (no body).
      const classMethodPaths = collection.find(ctx.j.ClassMethod).paths();
      const declareMethodPaths = collection.find(ctx.j.TSDeclareMethod).paths();
      const methodDefPaths = collection.find(ctx.j.MethodDefinition).paths();

      const propertyMethods = collection
        .find(ctx.j.ClassProperty)
        .filter((path: ASTPath<ClassProperty>): boolean => {
          const value = path.value.value;
          const hasArrowFunction = Boolean(
            value && typeof value === 'object' && 'type' in value && value.type === 'ArrowFunctionExpression'
          );

          const hasFunctionType = isFunctionTypeProperty(path.value);

          return hasArrowFunction || hasFunctionType;
        });

      methodNodes = ctx.j([...classMethodPaths, ...declareMethodPaths, ...methodDefPaths, ...propertyMethods.paths()]);
    } else {
      // Interface methods - include both method signatures and function-typed properties
      const interfaceMethods = collection.find(ctx.j.TSMethodSignature);

      const functionTypedProps = collection.find(ctx.j.TSPropertySignature).filter((path): boolean => {
        return isFunctionTypeProperty(path.value);
      });

      // Combine both collections
      methodNodes = ctx.j([...interfaceMethods.paths(), ...functionTypedProps.paths()]);
    }

    methodNodes.forEach((path) => {
      try {
        const node = path.value as MethodLikeNode;
        const methodName = getNodeKeyName(node, ctx.logger);

        if (!methodName) {
          ctx.logger.info('Skipping method with invalid name', {
            parentId,
            nodeType: node.type,
          });
          return;
        }

        const methodKind = getNodeProp(node, 'kind');
        const methodKey =
          methodKind === 'get' || methodKind === 'set' ? `${methodName}:${methodKind}` : methodName;
        const methodId = generateMethodUUID(ctx.packageId, moduleId, parentId, methodKey);
        const hasExplicitReturnType = getReturnTypeNode(node) != null;
        const returnType = getReturnType(ctx, node);

        // Parse parameters and store them in the result object
        const parameters = parseParameters(ctx, node, methodId, moduleId);

        const isStatic = parentType === 'class' && getBooleanProp(node, 'static');
        const isAbstract = getBooleanProp(node, 'abstract');
        const visibility = getVisibility(node);
        const isAsync = isAsyncMethod(node);

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

        appendTypeReferences(result, returnType, 'return_type', methodId, 'method');
        parameters.forEach((parameter) => {
          appendTypeReferences(result, parameter.type, 'parameter_type', parameter.id, 'parameter');
        });
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
  result: ParseResult,
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
      const propertyName = getNodeKeyName(propertyNode, ctx.logger);
      if (!propertyName) {
        ctx.logger.error('Invalid property name');
        return;
      }

      // Check if this property has a function type annotation
      const isFnType = isFunctionTypeProperty(propertyNode);
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

      const isStatic = getBooleanProp(propertyNode, 'static');
      const isReadonly = getBooleanProp(propertyNode, 'readonly');
      const visibility = getVisibility(propertyNode);

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

      appendTypeReferences(result, propertyType, 'property_type', propertyId, 'property');
    } catch (error: unknown) {
      ctx.logger.error(`Error parsing property: ${String(error)}`);
    }
  });

  if (parentType === 'class') {
    extractConstructorParameterProperties(
      ctx, collection, moduleId, parentId, propertyNameCounts, properties, result
    );
  }

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
  node: MethodLikeNode,
  methodId: string,
  moduleId: string
): IParameterCreateDTO[] {
  const parameters: IParameterCreateDTO[] = [];

  try {
    const params = getParametersList(node);

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
        if (param.argument.type === 'Identifier') {
          paramName = param.argument.name;
        } else {
          paramName = '...rest';
        }
        paramTypeAnnotation = param.typeAnnotation as TSTypeAnnotation | undefined;
      } else if (param.type === 'AssignmentPattern') {
        // x = defaultVal
        if (param.left.type === 'Identifier') {
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
        paramTypeAnnotation = (getNodeProp(param, 'typeAnnotation') as TSTypeAnnotation | undefined) ?? undefined;
      } else {
        ctx.logger.debug(`Skipping unsupported parameter type: ${param.type}`);
        continue;
      }

      const paramType = getTypeFromAnnotation(ctx.j, paramTypeAnnotation, ctx.logger);
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
    ctx.logger.error(`Error parsing parameters: ${getErrorMessage(error)}`);
  }

  return parameters;
}

/**
 * Extract the parameters list from a method-like node.
 * Handles MethodDefinition, ClassProperty (arrow functions), TSMethodSignature,
 * and TSPropertySignature (function-typed properties).
 */
function getParametersList(
  node: MethodLikeNode
): ASTNode[] {
  if ('params' in node && Array.isArray(node.params)) {
    return node.params;
  }
  if ('value' in node && node.value) {
    if ('params' in node.value) {
      return node.value.params;
    }
  }
  if ('parameters' in node) {
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
  node: MethodLikeNode
): string {
  try {
    const returnTypeNode = getReturnTypeNode(node);
    return getTypeFromAnnotation(ctx.j, returnTypeNode, ctx.logger) || 'void';
  } catch (error) {
    ctx.logger.error(`Error getting return type: ${getErrorMessage(error)}`);
    return 'void';
  }
}

/**
 * Extract the return type annotation node from a method-like node.
 */
function getReturnTypeNode(
  node: MethodLikeNode
): TSTypeAnnotation | undefined {
  if ('returnType' in node && node.returnType) {
    return node.returnType as TSTypeAnnotation;
  }
  if ('value' in node && node.value) {
    if ('returnType' in node.value && node.value.returnType) {
      return node.value.returnType as TSTypeAnnotation;
    }
  }
  if ('typeAnnotation' in node && node.typeAnnotation) {
    return node.typeAnnotation as TSTypeAnnotation;
  }
  return undefined;
}

/**
 * Extract constructor parameter properties (e.g., `constructor(private readonly x: string)`).
 * In TypeScript, constructor parameters with accessibility modifiers (public/private/protected)
 * or `readonly` implicitly declare class properties. The Babel AST represents these as
 * `TSParameterProperty` nodes wrapping the actual parameter.
 */
function extractConstructorParameterProperties(
  ctx: ModuleParserContext,
  collection: Collection,
  moduleId: string,
  parentId: string,
  propertyNameCounts: Map<string, number>,
  properties: IPropertyCreateDTO[],
  result: ParseResult
): void {
  const constructors = collection.find(ctx.j.ClassMethod, { kind: 'constructor' });
  constructors.forEach((ctorPath) => {
    for (const param of ctorPath.node.params) {
      if (param.type !== 'TSParameterProperty') continue;

      const accessibility = getNodeProp(param, 'accessibility');
      const isReadonly = getNodeProp(param, 'readonly') === true;
      if (typeof accessibility !== 'string' && !isReadonly) continue;

      const innerParam = getNodeProp(param, 'parameter');
      if (!innerParam || typeof innerParam !== 'object' || !('type' in innerParam)) continue;

      const innerNode = innerParam as ASTNode;
      let paramName: string;
      let paramTypeAnnotation: TSTypeAnnotation | undefined;

      if (innerNode.type === 'Identifier') {
        paramName = (innerNode as unknown as { name: string }).name;
        paramTypeAnnotation = getNodeProp(innerNode, 'typeAnnotation') as TSTypeAnnotation | undefined;
      } else if (innerNode.type === 'AssignmentPattern') {
        const left = getNodeProp(innerNode, 'left') as ASTNode | undefined;
        if (left?.type === 'Identifier') {
          paramName = (left as unknown as { name: string }).name;
          paramTypeAnnotation = getNodeProp(left, 'typeAnnotation') as TSTypeAnnotation | undefined;
        } else {
          continue;
        }
      } else {
        continue;
      }

      const propertyType = getTypeFromAnnotation(ctx.j, paramTypeAnnotation, ctx.logger);

      const seenCount = propertyNameCounts.get(paramName) ?? 0;
      propertyNameCounts.set(paramName, seenCount + 1);
      const propertyKey = seenCount === 0 ? paramName : `${paramName}_${String(seenCount)}`;

      const propertyId = generatePropertyUUID(ctx.packageId, moduleId, parentId, propertyKey, 'class');

      properties.push({
        id: propertyId,
        module_id: moduleId,
        parent_id: parentId,
        parent_type: 'class',
        name: paramName,
        type: propertyType,
        package_id: ctx.packageId,
        is_static: false,
        is_readonly: isReadonly,
        visibility: typeof accessibility === 'string' ? accessibility : 'public',
      });

      appendTypeReferences(result, propertyType, 'property_type', propertyId, 'property');
    }
  });
}

/**
 * Check if a property has a function type annotation (TSFunctionType,
 * TSConstructorType, or is an arrow function expression).
 */
function isFunctionTypeProperty(node: ClassProperty | TSPropertySignature): boolean {
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
}
