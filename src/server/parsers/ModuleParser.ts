import { access, readFile } from 'fs/promises';
import { dirname, join, relative } from 'path';

import jscodeshift from 'jscodeshift';

import { Export } from '../../shared/types/Export';
import { Import, ImportSpecifier } from '../../shared/types/Import';
import { createLogger } from '../../shared/utils/logger';
import {
  generateClassUUID,
  generateEnumUUID,
  generateExportUUID,
  generateFunctionUUID,
  generateImportUUID,
  generateInterfaceUUID,
  generateMethodUUID,
  generateModuleUUID,
  generateParameterUUID,
  generatePropertyUUID,
  generateTypeAliasUUID,
  generateVariableUUID,
} from '../utils/uuid';

import type {
  ASTNode,
  ASTPath,
  ClassDeclaration,
  ClassProperty,
  Collection,
  ExportNamedDeclaration,
  Identifier,
  ImportDeclaration,
  JSCodeshift,
  JSXIdentifier,
  MethodDefinition,
  TSInterfaceDeclaration,
  TSMethodSignature,
  TSPropertySignature,
  TSTypeAnnotation,
  TSTypeParameter,
} from 'jscodeshift';

import type { FileLocation } from '../../shared/types/FileLocation';
import type { IClassCreateDTO } from '../db/repositories/ClassRepository';
import type { IEnumCreateDTO } from '../db/repositories/EnumRepository';
import type { IFunctionCreateDTO } from '../db/repositories/FunctionRepository';
import type { IInterfaceCreateDTO } from '../db/repositories/InterfaceRepository';
import type { IMethodCreateDTO } from '../db/repositories/MethodRepository';
import type { IModuleCreateDTO } from '../db/repositories/ModuleRepository';
import type { IParameterCreateDTO } from '../db/repositories/ParameterRepository';
import type { IPropertyCreateDTO } from '../db/repositories/PropertyRepository';
import type { ITypeAliasCreateDTO } from '../db/repositories/TypeAliasRepository';
import type { IVariableCreateDTO } from '../db/repositories/VariableRepository';
import type { ClassExtendsRef, ClassImplementsRef, InterfaceExtendsRef, ParseResult, SymbolUsageRef } from './ParseResult';

export class ModuleParser {
  private j: JSCodeshift;
  private root: Collection | undefined;
  private moduleId!: string;
  private imports = new Map<string, Import>();
  private exports = new Set<string>();
  private reExports = new Set<string>();
  private readonly logger;

  constructor(
    private readonly filePath: string,
    private readonly packageId: string,
    private readonly sourceOverride?: string
  ) {
    this.j = jscodeshift.withParser('tsx');
    this.root = undefined; // Will be initialized in parse()
    this.logger = createLogger('ModuleParser');
  }

  // Safely get identifier name to work around type issues
  private getIdentifierName(id: string | Identifier | JSXIdentifier | TSTypeParameter): string | null {
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
  private getHeritageClauseName(node: ASTNode): string | null {
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

  async parse(): Promise<ParseResult> {
    this.moduleId = generateModuleUUID(this.packageId, this.filePath);
    const relativePath = relative(process.cwd(), this.filePath);

    try {
      const content = this.sourceOverride ?? (await readFile(this.filePath, 'utf-8'));
      this.root = this.j(content);

      // Reset tracking collections
      this.imports.clear();
      this.exports.clear();
      this.reExports.clear();

      const result: ParseResult = {
        package: undefined,
        modules: [await this.createModuleDTO(this.moduleId, relativePath)],
        classes: [] as IClassCreateDTO[],
        interfaces: [] as IInterfaceCreateDTO[],
        functions: [] as IFunctionCreateDTO[],
        typeAliases: [] as ITypeAliasCreateDTO[],
        enums: [] as IEnumCreateDTO[],
        variables: [] as IVariableCreateDTO[],
        methods: [] as IMethodCreateDTO[],
        properties: [] as IPropertyCreateDTO[],
        parameters: [] as IParameterCreateDTO[],
        imports: [] as Import[],
        exports: [] as Export[],
        classExtends: [] as ClassExtendsRef[],
        classImplements: [] as ClassImplementsRef[],
        interfaceExtends: [] as InterfaceExtendsRef[],
        symbolUsages: [] as SymbolUsageRef[],
        symbolReferences: [],
      };

      this.parseImportsAndExports();
      this.parseClasses(this.moduleId, result);
      this.parseInterfaces(this.moduleId, result);
      this.parseFunctions(this.moduleId, result);
      this.parseTypeAliases(this.moduleId, result);
      this.parseEnums(this.moduleId, result);
      this.parseVariables(this.moduleId, result);

      // Add collected imports and exports to result
      result.imports = Array.from(this.imports.values());
      result.exports = Array.from(this.exports).map(
        (exportName) => new Export(generateExportUUID(this.moduleId, exportName), this.moduleId, exportName, false)
      );

      return result;
    } catch (error) {
      console.warn(
        `Warning: Failed to process ${relativePath}:`,
        error instanceof Error ? error.message : String(error)
      );

      return {
        modules: [await this.createModuleDTO(this.moduleId, relativePath)],
        classes: [],
        functions: [],
        typeAliases: [],
        enums: [],
        variables: [],
        interfaces: [],
        methods: [],
        properties: [],
        parameters: [],
        imports: [],
        exports: [],
        classExtends: [],
        classImplements: [],
        interfaceExtends: [],
        symbolUsages: [],
        symbolReferences: [],
      };
    }
  }

  private parseImportsAndExports(): void {
    if (!this.root) return;

    // Parse imports first
    this.root.find(this.j.ImportDeclaration).forEach((path: ASTPath<ImportDeclaration>) => {
      const importPath = path.node.source.value;
      if (typeof importPath !== 'string') return;

      const importSpecifiers = new Map<string, ImportSpecifier>();
      const isTypeImport = path.node.importKind === 'type';

      path.node.specifiers?.forEach((specifier) => {
        if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier') {
          const importedName = specifier.imported.name;
          const localName = specifier.local?.type === 'Identifier' ? specifier.local.name : importedName;
          const uuid = generateImportUUID(importPath, importedName);
          const kind = isTypeImport ? 'type' : 'value';
          const aliases = new Set<string>();
          if (localName !== importedName) {
            aliases.add(localName);
          }
          const importSpecifier = new ImportSpecifier(
            uuid,
            importedName,
            kind,
            undefined,
            new Set(),
            aliases
          );
          importSpecifiers.set(localName, importSpecifier);
        } else if (specifier.type === 'ImportDefaultSpecifier' && specifier.local?.type === 'Identifier') {
          const name = specifier.local.name;
          const uuid = generateImportUUID(importPath, name);
          const kind = isTypeImport ? 'type' : 'default';
          const importSpecifier = new ImportSpecifier(uuid, name, kind, undefined, new Set(), new Set());
          importSpecifiers.set(name, importSpecifier);
        } else if (specifier.type === 'ImportNamespaceSpecifier' && specifier.local?.type === 'Identifier') {
          const name = specifier.local.name;
          const uuid = generateImportUUID(importPath, name);
          const kind = isTypeImport ? 'type' : 'namespace';
          const importSpecifier = new ImportSpecifier(uuid, name, kind, undefined, new Set(), new Set());
          importSpecifiers.set(name, importSpecifier);
        }
      });

      const existingImport = this.imports.get(importPath);
      if (existingImport) {
        importSpecifiers.forEach((spec, name) => {
          if (!existingImport.specifiers.has(name)) {
            existingImport.specifiers.set(name, spec);
          }
        });
        return;
      }

      // Create the Import instance with module-specific UUID (even for side-effect imports)
      const uuid = generateImportUUID(this.moduleId, importPath);
      const imp = new Import(uuid, importPath, importPath, importPath, importSpecifiers);
      this.imports.set(importPath, imp);
    });

    // Parse exports and track re-exports
    this.root.find(this.j.ExportNamedDeclaration).forEach((path: ASTPath<ExportNamedDeclaration>) => {
      // Handle re-exports (export { x } from 'module')
      if (path.node.source) {
        path.node.specifiers?.forEach((specifier) => {
          if (specifier.exported.type === 'Identifier') {
            this.reExports.add(specifier.exported.name);
            this.exports.add(specifier.exported.name);
          }
        });
      }
      // Handle local exports
      else if (path.node.declaration) {
        if (path.node.declaration.type === 'ClassDeclaration' && path.node.declaration.id) {
          const name = this.getIdentifierName(path.node.declaration.id);
          if (name) this.exports.add(name);
        } else if (path.node.declaration.type === 'VariableDeclaration') {
          path.node.declaration.declarations.forEach((decl) => {
            if ('id' in decl && decl.id.type === 'Identifier') {
              const name = this.getIdentifierName(decl.id);
              if (name) this.exports.add(name);
            }
          });
        } else if (path.node.declaration.type === 'FunctionDeclaration' && path.node.declaration.id) {
          const name = this.getIdentifierName(path.node.declaration.id);
          if (name) this.exports.add(name);
        } else if (path.node.declaration.type === 'TSTypeAliasDeclaration') {
          const name = this.getIdentifierName(path.node.declaration.id);
          if (name) this.exports.add(name);
        } else if (path.node.declaration.type === 'TSEnumDeclaration') {
          const name = this.getIdentifierName(path.node.declaration.id);
          if (name) this.exports.add(name);
        }
      }
    });

    // Also handle export * from 'module'
    this.root.find(this.j.ExportAllDeclaration).forEach((path) => {
      if (typeof path.node.source.value === 'string') {
        // Mark this module as having re-exports
        this.reExports.add('*');
      }
    });
  }

  private isBarrelFile(): boolean {
    if (this.exports.size === 0) return false;

    // If we have a wildcard export, consider it a barrel
    if (this.reExports.has('*')) return true;

    // Calculate the ratio of re-exports to total exports
    const reExportRatio = this.reExports.size / this.exports.size;

    // Consider it a barrel if more than 80% of exports are re-exports
    return reExportRatio > 0.8;
  }

  private async createModuleDTO(moduleId: string, relativePath: string): Promise<IModuleCreateDTO> {
    const directory = dirname(this.filePath);
    const fullName = relativePath.split('/').pop() ?? '';
    const name = fullName.replace(/\.[^/.]+$/, '');

    // Check for index files
    let indexFile: string | undefined;
    const indexCandidates = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs', 'index.vue'];
    for (const candidate of indexCandidates) {
      const candidatePath = join(directory, candidate);
      try {
        await access(candidatePath);
        indexFile = candidatePath;
        break;
      } catch {
        // Continue checking candidates
      }
    }

    return {
      id: moduleId,
      package_id: this.packageId,
      name,
      source: {
        directory,
        name,
        filename: this.filePath,
        relativePath,
        index: indexFile,
        isBarrel: this.isBarrelFile(),
      } as FileLocation,
    };
  }

  private parseClasses(moduleId: string, result: ParseResult): void {
    if (!this.root) return;

    this.root.find(this.j.ClassDeclaration).forEach((path) => {
      const node = path.node;
      if (!node.id?.name) return;

      const className = this.getIdentifierName(node.id);
      if (!className) return;

      const classId = generateClassUUID(this.packageId, moduleId, className);
      const classDTO = this.createClassDTO(classId, moduleId, node);
      result.classes.push(classDTO);

      // Extract extends relationship (deferred name-based resolution)
      if (node.superClass?.type === 'Identifier' && node.superClass.name) {
        result.classExtends.push({
          classId,
          parentName: node.superClass.name,
        });
      }

      // Extract implements relationships (deferred name-based resolution)
      if (node.implements && Array.isArray(node.implements)) {
        for (const impl of node.implements) {
          const name = this.getHeritageClauseName(impl);
          if (name) {
            result.classImplements.push({ classId, interfaceName: name });
          }
        }
      }

      // Parse methods and properties and add them to result
      const methods = this.parseClassMethods(moduleId, classId, node, result);
      const properties = this.parseClassProperties(moduleId, classId, node);

      result.methods.push(...methods);
      result.properties.push(...properties);
    });
  }

  private createClassDTO(classId: string, moduleId: string, node: ClassDeclaration): IClassCreateDTO {
    if (node.id?.type !== 'Identifier') {
      throw new Error('Invalid class declaration: missing identifier');
    }

    return {
      id: classId,
      package_id: this.packageId,
      module_id: moduleId,
      name: node.id.name,
      // Note: extends_id is no longer set here. The parent class name is captured
      // in result.classExtends and resolved to a UUID after all modules are parsed.
    };
  }

  private parseInterfaces(moduleId: string, result: ParseResult): void {
    if (!this.root) return;
    this.root.find(this.j.TSInterfaceDeclaration).forEach((path) => {
      const node = path.node;
      if (node.id.type !== 'Identifier' || !node.id.name) return;

      const interfaceId = generateInterfaceUUID(this.packageId, moduleId, node.id.name);
      const interfaceDTO = this.createInterfaceDTO(interfaceId, moduleId, node);
      result.interfaces.push(interfaceDTO);

      // Extract extends relationships (deferred name-based resolution)
      if (node.extends && Array.isArray(node.extends)) {
        for (const ext of node.extends) {
          const name = this.getHeritageClauseName(ext as ASTNode);
          if (name) {
            result.interfaceExtends.push({ interfaceId, parentName: name });
          }
        }
      }

      // Parse methods and properties and add them to result
      const methods = this.parseInterfaceMethods(moduleId, interfaceId, node, result);
      const properties = this.parseInterfaceProperties(moduleId, interfaceId, node);

      result.methods.push(...methods);
      result.properties.push(...properties);
    });
  }

  private createInterfaceDTO(interfaceId: string, moduleId: string, node: TSInterfaceDeclaration): IInterfaceCreateDTO {
    return {
      id: interfaceId,
      package_id: this.packageId,
      module_id: moduleId,
      name: node.id.type === 'Identifier' ? node.id.name : '',
    };
  }

  private extractSymbolUsages(
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

    this.j(node)
      .find(this.j.MemberExpression)
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

  private parseClassMethods(
    moduleId: string,
    classId: string,
    node: ClassDeclaration,
    result: ParseResult
  ): IMethodCreateDTO[] {
    try {
      const parentName =
        node.id && typeof node.id === 'object' && 'name' in node.id && typeof node.id.name === 'string'
          ? node.id.name
          : undefined;
      return this.parseMethods(this.j(node), 'class', classId, moduleId, result, parentName);
    } catch (error: unknown) {
      this.logger.error(`Error parsing class methods: ${String(error)}`);
      return [];
    }
  }

  private parseInterfaceMethods(
    moduleId: string,
    interfaceId: string,
    node: TSInterfaceDeclaration,
    result: ParseResult
  ): IMethodCreateDTO[] {
    try {
      const parentName = 'name' in node.id && typeof node.id.name === 'string' ? node.id.name : undefined;
      return this.parseMethods(this.j(node), 'interface', interfaceId, moduleId, result, parentName);
    } catch (error: unknown) {
      this.logger.error(`Error parsing interface methods: ${String(error)}`);
      return [];
    }
  }

  private parseMethods(
    collection: Collection,
    parentType: 'class' | 'interface',
    parentId: string,
    moduleId: string,
    result: ParseResult,
    parentName?: string
  ): IMethodCreateDTO[] {
    const methods: IMethodCreateDTO[] = [];

    try {
      // Expand method node collection to include more patterns
      let methodNodes: Collection;

      if (parentType === 'class') {
        // Get method definitions
        const classMethods = collection.find(this.j.MethodDefinition);

        // Add class property arrow functions
        const propertyMethods = collection
          .find(this.j.ClassProperty)
          .filter((path: ASTPath<ClassProperty>): boolean => {
            const value = path.value.value;
            const hasArrowFunction = Boolean(
              value && typeof value === 'object' && 'type' in value && value.type === 'ArrowFunctionExpression'
            );

            // Also check for function type annotations
            const hasFunctionType = this.isFunctionTypeProperty(path.value);

            return hasArrowFunction || hasFunctionType;
          });

        // Combine both collections
        methodNodes = this.j([...classMethods.paths(), ...propertyMethods.paths()]);
      } else {
        // Interface methods - include both method signatures and function-typed properties
        const interfaceMethods = collection.find(this.j.TSMethodSignature);

        const functionTypedProps = collection.find(this.j.TSPropertySignature).filter((path): boolean => {
          return this.isFunctionTypeProperty(path.value);
        });

        // Combine both collections
        methodNodes = this.j([...interfaceMethods.paths(), ...functionTypedProps.paths()]);
      }

      methodNodes.forEach((path) => {
        try {
          const node = path.value as MethodDefinition | TSMethodSignature | ClassProperty | TSPropertySignature;
          const methodName = this.getMethodName(node);

          if (!methodName) {
            this.logger.info('Skipping method with invalid name', {
              parentId,
              nodeType: node.type,
            });
            return;
          }

          const methodId = generateMethodUUID(this.packageId, moduleId, parentId, methodName);
          const returnType = this.getReturnType(node);

          // Parse parameters and store them in the result object
          const parameters = this.parseParameters(node, methodId, moduleId);

          // Add static detection with type guard
          const isStatic = parentType === 'class' && 'static' in node && node.static;

          // Add async detection with type guard
          const isAsync =
            parentType === 'class' &&
            'value' in node &&
            node.value !== null &&
            node.value.type === 'FunctionExpression' &&
            node.value.async === true;

          methods.push({
            id: methodId,
            name: methodName,
            package_id: this.packageId,
            module_id: moduleId,
            parent_id: parentId,
            parent_type: parentType,
            return_type: returnType,
            is_static: isStatic,
            is_async: isAsync,
            visibility: 'public', // Default visibility
          });

          const usages = this.extractSymbolUsages(node, {
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
          this.logger.error('Error parsing individual method:', { error, parentId });
        }
      });
    } catch (error) {
      this.logger.error('Error parsing methods:', { error, parentId });
    }

    return methods;
  }

  private parseClassProperties(moduleId: string, classId: string, node: ClassDeclaration): IPropertyCreateDTO[] {
    try {
      return this.parseProperties(moduleId, classId, 'class', node);
    } catch (error: unknown) {
      this.logger.error(`Error parsing class properties: ${String(error)}`);
      return [];
    }
  }

  private parseInterfaceProperties(
    moduleId: string,
    interfaceId: string,
    node: TSInterfaceDeclaration
  ): IPropertyCreateDTO[] {
    try {
      return this.parseProperties(moduleId, interfaceId, 'interface', node);
    } catch (error: unknown) {
      this.logger.error(`Error parsing interface properties: ${String(error)}`);
      return [];
    }
  }

  private parseProperties(
    moduleId: string,
    parentId: string,
    parentType: 'class' | 'interface',
    node: ClassDeclaration | TSInterfaceDeclaration
  ): IPropertyCreateDTO[] {
    const properties: IPropertyCreateDTO[] = [];
    const collection = this.j(node);
    const propertyNodes =
      parentType === 'class' ? collection.find(this.j.ClassProperty) : collection.find(this.j.TSPropertySignature);

    propertyNodes.forEach((path, index) => {
      try {
        const propertyNode = path.node;
        const propertyName = this.getPropertyName(propertyNode);
        if (!propertyName) {
          this.logger.error('Invalid property name');
          return;
        }

        // Check if this property has a function type annotation
        const isFunctionType = this.isFunctionTypeProperty(propertyNode);
        if (isFunctionType) {
          // Skip function-typed properties - they should be handled as methods
          this.logger.debug(`Skipping function-typed property: ${propertyName}`);
          return;
        }

        const propertyType = this.getTypeFromAnnotation(propertyNode.typeAnnotation as TSTypeAnnotation);
        // Generate a unique property ID using package, module, parent, property info, and position
        const propertyId = generatePropertyUUID(
          this.packageId,
          moduleId,
          parentId,
          `${propertyName}_${String(index)}`,
          parentType
        );

        properties.push({
          id: propertyId,
          module_id: moduleId,
          parent_id: parentId,
          parent_type: parentType,
          name: propertyName,
          type: propertyType,
          package_id: this.packageId,
          is_static: false,
          is_readonly: false,
          visibility: 'public',
        });
      } catch (error: unknown) {
        this.logger.error(`Error parsing property: ${String(error)}`);
      }
    });

    return properties;
  }

  /**
   * Check if a property has a function type annotation
   */
  private isFunctionTypeProperty(node: ClassProperty | TSPropertySignature): boolean {
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
      this.logger.error('Error checking function type:', { error });
      return false;
    }
  }

  private getMethodName(
    node: MethodDefinition | TSMethodSignature | ClassProperty | TSPropertySignature
  ): string | undefined {
    try {
      return node.key.type === 'Identifier' ? node.key.name : undefined;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Error getting method name:', { error: errorMessage });
      return undefined;
    }
  }

  private getPropertyName(node: ClassProperty | TSPropertySignature): string | undefined {
    try {
      if (node.key.type === 'Identifier') {
        return node.key.name;
      }
      return undefined;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Error getting property name:', { error: errorMessage });
      return undefined;
    }
  }

  private parseParameters(
    node: MethodDefinition | TSMethodSignature | ClassProperty | TSPropertySignature,
    methodId: string,
    moduleId: string
  ): IParameterCreateDTO[] {
    const parameters: IParameterCreateDTO[] = [];

    try {
      const params = this.getParametersList(node);
      if (!Array.isArray(params)) {
        return parameters;
      }

      for (const param of params) {
        if (param.type !== 'Identifier') {
          continue;
        }

        const paramType = this.getTypeFromAnnotation(param.typeAnnotation as TSTypeAnnotation);
        const paramId = generateParameterUUID(methodId, param.name);

        parameters.push({
          id: paramId,
          name: param.name,
          type: paramType,
          package_id: this.packageId,
          module_id: moduleId,
          method_id: methodId,
          is_optional: false,
          is_rest: false,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error parsing parameters: ${errorMessage}`);
    }

    return parameters;
  }

  private getParametersList(
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

  private getReturnType(node: MethodDefinition | TSMethodSignature | ClassProperty | TSPropertySignature): string {
    try {
      const returnTypeNode = this.getReturnTypeNode(node);
      return this.getTypeFromAnnotation(returnTypeNode) || 'void';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error getting return type: ${errorMessage}`);
      return 'void';
    }
  }

  private getReturnTypeNode(
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

  private getTypeFromAnnotation(annotation: TSTypeAnnotation | null | undefined): string {
    if (!annotation) {
      return 'any';
    }

    try {
      return (
        this.j(annotation)
          .toSource()
          .replace(/[\n\s]+/g, ' ')
          .trim() || 'any'
      );
    } catch (error: unknown) {
      this.logger.error('Error getting type from annotation:', { error: String(error) });
      return 'any';
    }
  }

  /**
   * Parse module-level function declarations
   */
  private parseFunctions(moduleId: string, result: ParseResult): void {
    if (!this.root) return;

    const seenFunctionIds = new Set<string>();

    const captureFunction = (node: ASTNode): void => {
      if (node.type !== 'FunctionDeclaration' || !node.id) return;

      const idName = this.getIdentifierName(node.id);
      if (!idName) return;

      const functionName = idName;

      // Only capture exported functions — this tool visualizes public API surface
      if (!this.exports.has(functionName)) return;

      const functionId = generateFunctionUUID(this.packageId, moduleId, functionName);
      if (seenFunctionIds.has(functionId)) {
        return;
      }
      seenFunctionIds.add(functionId);

      const returnType = this.getReturnTypeFromNode(node);

      const functionDTO: IFunctionCreateDTO = {
        id: functionId,
        package_id: this.packageId,
        module_id: moduleId,
        name: functionName,
        return_type: returnType,
        is_async: node.async ?? false,
        is_exported: true,
      };

      result.functions.push(functionDTO);

      const usages = this.extractSymbolUsages(node, {
        moduleId,
        sourceSymbolId: functionId,
        sourceSymbolType: 'function',
        sourceSymbolName: functionName,
      });
      if (usages.length > 0) {
        result.symbolUsages.push(...usages);
      }
    };

    this.root.find(this.j.Program).forEach((programPath: ASTPath) => {
      const programNode = programPath.node;
      if (programNode.type !== 'Program') {
        return;
      }

      programNode.body.forEach((statement) => {
        try {
          if (statement.type === 'FunctionDeclaration') {
            captureFunction(statement);
            return;
          }

          if (
            (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') &&
            statement.declaration
          ) {
            captureFunction(statement.declaration as ASTNode);
          }
        } catch (error) {
          this.logger.error('Error parsing function:', error);
        }
      });
    });
  }

  /**
   * Get return type from a function node
   */
  private getReturnTypeFromNode(node: ASTNode): string {
    try {
      if ('returnType' in node && node.returnType) {
        const returnType = node.returnType as TSTypeAnnotation;
        return this.getTypeFromAnnotation(returnType);
      }
    } catch (error) {
      this.logger.error('Error getting return type:', error);
    }
    return 'void';
  }

  /**
   * Parse module-level type alias declarations (type Foo = ...)
   */
  private parseTypeAliases(moduleId: string, result: ParseResult): void {
    if (!this.root) return;

    const seenIds = new Set<string>();

    const captureTypeAlias = (node: ASTNode): void => {
      if (node.type !== 'TSTypeAliasDeclaration') return;

      const idName = this.getIdentifierName(node.id);
      if (!idName) return;

      // Only capture exported type aliases — this tool visualizes public API surface
      if (!this.exports.has(idName)) return;

      const aliasId = generateTypeAliasUUID(this.packageId, moduleId, idName);
      if (seenIds.has(aliasId)) return;
      seenIds.add(aliasId);

      // Extract the type body as source text
      let typeBody = 'unknown';
      try {
        typeBody = this.j(node.typeAnnotation as ASTNode).toSource().replace(/[\n\s]+/g, ' ').trim() || 'unknown';
      } catch {
        typeBody = 'unknown';
      }

      // Extract type parameters
      let typeParametersJson: string | undefined;
      try {
        if ('typeParameters' in node && node.typeParameters) {
          const params = node.typeParameters as ASTNode;
          if ('params' in params && Array.isArray(params.params)) {
            const names = (params.params as TSTypeParameter[])
              .map((p) => this.getIdentifierName(p as unknown as Identifier))
              .filter((n): n is string => n !== null);
            if (names.length > 0) {
              typeParametersJson = JSON.stringify(names);
            }
          }
        }
      } catch {
        // ignore type parameter extraction failures
      }

      const dto: ITypeAliasCreateDTO = {
        id: aliasId,
        package_id: this.packageId,
        module_id: moduleId,
        name: idName,
        type: typeBody,
        type_parameters_json: typeParametersJson,
      };

      result.typeAliases.push(dto);
    };

    this.root.find(this.j.Program).forEach((programPath: ASTPath) => {
      const programNode = programPath.node;
      if (programNode.type !== 'Program') return;

      programNode.body.forEach((statement) => {
        try {
          if (statement.type === 'TSTypeAliasDeclaration') {
            captureTypeAlias(statement);
            return;
          }
          if (
            (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') &&
            statement.declaration
          ) {
            captureTypeAlias(statement.declaration as ASTNode);
          }
        } catch (error) {
          this.logger.error('Error parsing type alias:', error);
        }
      });
    });
  }

  /**
   * Parse module-level enum declarations
   */
  private parseEnums(moduleId: string, result: ParseResult): void {
    if (!this.root) return;

    const seenIds = new Set<string>();

    const captureEnum = (node: ASTNode): void => {
      if (node.type !== 'TSEnumDeclaration') return;

      const idName = this.getIdentifierName(node.id);
      if (!idName) return;

      // Only capture exported enums — this tool visualizes public API surface
      if (!this.exports.has(idName)) return;

      const enumId = generateEnumUUID(this.packageId, moduleId, idName);
      if (seenIds.has(enumId)) return;
      seenIds.add(enumId);

      // Extract member names
      let membersJson: string | undefined;
      try {
        if ('members' in node && Array.isArray(node.members)) {
          const memberNames = (node.members as ASTNode[])
            .map((m) => {
              if ('id' in m && m.id) {
                const mid = m.id as ASTNode;
                if (mid.type === 'Identifier' && 'name' in mid) {
                  return mid.name;
                }
              }
              return null;
            })
            .filter((n): n is string => n !== null);
          if (memberNames.length > 0) {
            membersJson = JSON.stringify(memberNames);
          }
        }
      } catch {
        // ignore member extraction failures
      }

      const dto: IEnumCreateDTO = {
        id: enumId,
        package_id: this.packageId,
        module_id: moduleId,
        name: idName,
        members_json: membersJson,
      };

      result.enums.push(dto);
    };

    this.root.find(this.j.Program).forEach((programPath: ASTPath) => {
      const programNode = programPath.node;
      if (programNode.type !== 'Program') return;

      programNode.body.forEach((statement) => {
        try {
          if (statement.type === 'TSEnumDeclaration') {
            captureEnum(statement);
            return;
          }
          if (
            (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') &&
            statement.declaration
          ) {
            captureEnum(statement.declaration as ASTNode);
          }
        } catch (error) {
          this.logger.error('Error parsing enum:', error);
        }
      });
    });
  }

  /**
   * Parse module-level variable declarations (const, let, var)
   */
  private parseVariables(moduleId: string, result: ParseResult): void {
    if (!this.root) return;

    const seenIds = new Set<string>();

    const captureVariableDeclaration = (node: ASTNode): void => {
      if (node.type !== 'VariableDeclaration') return;

      const kind = (node as { kind: string }).kind as 'const' | 'let' | 'var';

      if (!('declarations' in node) || !Array.isArray(node.declarations)) return;

      for (const declarator of node.declarations as ASTNode[]) {
        try {
          if (!('id' in declarator) || !declarator.id) continue;

          const idNode = declarator.id as ASTNode;
          // Skip destructured patterns — only capture simple identifiers
          if (idNode.type !== 'Identifier') continue;

          const varName = this.getIdentifierName(idNode);
          if (!varName) continue;

          // Only capture exported variables — this tool visualizes public API surface
          if (!this.exports.has(varName)) continue;

          const varId = generateVariableUUID(this.packageId, moduleId, varName);
          if (seenIds.has(varId)) continue;
          seenIds.add(varId);

          // Extract type annotation
          let varType: string | undefined;
          if ('typeAnnotation' in idNode && idNode.typeAnnotation) {
            varType = this.getTypeFromAnnotation(idNode.typeAnnotation as TSTypeAnnotation);
          }

          // Extract initializer source text (truncated to 500 chars)
          let initializer: string | undefined;
          try {
            if ('init' in declarator && declarator.init) {
              const initSource = this.j(declarator.init as ASTNode).toSource().replace(/[\n\s]+/g, ' ').trim();
              if (initSource) {
                initializer = initSource.length > 500 ? initSource.slice(0, 500) + '...' : initSource;
              }
            }
          } catch {
            // ignore initializer extraction failures
          }

          const dto: IVariableCreateDTO = {
            id: varId,
            package_id: this.packageId,
            module_id: moduleId,
            name: varName,
            kind,
            type: varType,
            initializer,
          };

          result.variables.push(dto);
        } catch (error) {
          this.logger.error('Error parsing variable declarator:', error);
        }
      }
    };

    this.root.find(this.j.Program).forEach((programPath: ASTPath) => {
      const programNode = programPath.node;
      if (programNode.type !== 'Program') return;

      programNode.body.forEach((statement) => {
        try {
          if (statement.type === 'VariableDeclaration') {
            captureVariableDeclaration(statement);
            return;
          }
          if (
            (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') &&
            statement.declaration
          ) {
            captureVariableDeclaration(statement.declaration as ASTNode);
          }
        } catch (error) {
          this.logger.error('Error parsing variable:', error);
        }
      });
    });
  }
}
