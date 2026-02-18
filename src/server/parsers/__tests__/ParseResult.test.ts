// @vitest-environment node

import { Export } from '../../../shared/types/Export';
import { Import, ImportSpecifier } from '../../../shared/types/Import';

import type { IClassCreateDTO } from '../../db/repositories/ClassRepository';
import type { IEnumCreateDTO } from '../../db/repositories/EnumRepository';
import type { IFunctionCreateDTO } from '../../db/repositories/FunctionRepository';
import type { IInterfaceCreateDTO } from '../../db/repositories/InterfaceRepository';
import type { IMethodCreateDTO } from '../../db/repositories/MethodRepository';
import type { IModuleCreateDTO } from '../../db/repositories/ModuleRepository';
import type { IPackageCreateDTO } from '../../db/repositories/PackageRepository';
import type { IParameterCreateDTO } from '../../db/repositories/ParameterRepository';
import type { IPropertyCreateDTO } from '../../db/repositories/PropertyRepository';
import type { ISymbolReferenceCreateDTO } from '../../db/repositories/SymbolReferenceRepository';
import type { ITypeAliasCreateDTO } from '../../db/repositories/TypeAliasRepository';
import type { IVariableCreateDTO } from '../../db/repositories/VariableRepository';
import type {
  ClassExtendsRef,
  ClassImplementsRef,
  InterfaceExtendsRef,
  ParseResult,
  SymbolUsageRef,
} from '../ParseResult';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEmptyParseResult(): ParseResult {
  return {
    package: undefined,
    modules: [],
    classes: [],
    interfaces: [],
    functions: [],
    typeAliases: [],
    enums: [],
    variables: [],
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

function createSampleModule(overrides?: Partial<IModuleCreateDTO>): IModuleCreateDTO {
  return {
    id: 'mod-1',
    package_id: 'pkg-1',
    name: 'TestModule',
    source: {
      directory: '/src/',
      name: 'TestModule',
      filename: '/src/TestModule.ts',
      relativePath: 'src/TestModule.ts',
    },
    line_count: 100,
    ...overrides,
  };
}

function createSampleClass(overrides?: Partial<IClassCreateDTO>): IClassCreateDTO {
  return {
    id: 'cls-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    name: 'TestClass',
    ...overrides,
  };
}

function createSampleInterface(overrides?: Partial<IInterfaceCreateDTO>): IInterfaceCreateDTO {
  return {
    id: 'iface-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    name: 'TestInterface',
    ...overrides,
  };
}

function createSampleFunction(overrides?: Partial<IFunctionCreateDTO>): IFunctionCreateDTO {
  return {
    id: 'func-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    name: 'testFunction',
    ...overrides,
  };
}

function createSampleMethod(overrides?: Partial<IMethodCreateDTO>): IMethodCreateDTO {
  return {
    id: 'meth-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    parent_id: 'cls-1',
    parent_type: 'class',
    name: 'testMethod',
    return_type: 'void',
    is_static: false,
    is_async: false,
    visibility: 'public',
    ...overrides,
  };
}

function createSampleProperty(overrides?: Partial<IPropertyCreateDTO>): IPropertyCreateDTO {
  return {
    id: 'prop-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    parent_id: 'cls-1',
    parent_type: 'class',
    name: 'testProp',
    type: 'string',
    is_optional: false,
    is_static: false,
    is_readonly: false,
    visibility: 'public',
    ...overrides,
  };
}

function createSampleParameter(overrides?: Partial<IParameterCreateDTO>): IParameterCreateDTO {
  return {
    id: 'param-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    method_id: 'meth-1',
    name: 'arg',
    type: 'string',
    is_optional: false,
    is_rest: false,
    ...overrides,
  };
}

function createSamplePackage(overrides?: Partial<IPackageCreateDTO>): IPackageCreateDTO {
  return {
    id: 'pkg-1',
    name: 'test-package',
    version: '1.0.0',
    path: '/path/to/package',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ParseResult interface', () => {
  describe('empty ParseResult', () => {
    it('should have all required array fields initialized as empty', () => {
      const result = createEmptyParseResult();

      expect(result.modules).toEqual([]);
      expect(result.classes).toEqual([]);
      expect(result.interfaces).toEqual([]);
      expect(result.functions).toEqual([]);
      expect(result.typeAliases).toEqual([]);
      expect(result.enums).toEqual([]);
      expect(result.variables).toEqual([]);
      expect(result.methods).toEqual([]);
      expect(result.properties).toEqual([]);
      expect(result.parameters).toEqual([]);
      expect(result.imports).toEqual([]);
      expect(result.exports).toEqual([]);
      expect(result.classExtends).toEqual([]);
      expect(result.classImplements).toEqual([]);
      expect(result.interfaceExtends).toEqual([]);
      expect(result.symbolUsages).toEqual([]);
      expect(result.symbolReferences).toEqual([]);
    });

    it('should have package as undefined', () => {
      const result = createEmptyParseResult();
      expect(result.package).toBeUndefined();
    });

    it('should have importsWithModules as undefined when not set', () => {
      const result = createEmptyParseResult();
      expect(result.importsWithModules).toBeUndefined();
    });
  });

  describe('ParseResult with package', () => {
    it('should accept a package DTO', () => {
      const result = createEmptyParseResult();
      const pkg = createSamplePackage();
      result.package = pkg;

      expect(result.package).toBeDefined();
      expect(pkg.id).toBe('pkg-1');
      expect(pkg.name).toBe('test-package');
      expect(pkg.version).toBe('1.0.0');
      expect(pkg.path).toBe('/path/to/package');
    });

    it('should accept a package with dependencies', () => {
      const deps = new Map([['lodash', '^4.17.21']]);
      const devDeps = new Map([['vitest', '^1.0.0']]);
      const peerDeps = new Map([['react', '>=18']]);

      const result = createEmptyParseResult();
      const pkg = createSamplePackage({
        dependencies: deps,
        devDependencies: devDeps,
        peerDependencies: peerDeps,
      });
      result.package = pkg;

      expect(pkg.dependencies).toBeDefined();
      expect(deps.get('lodash')).toBe('^4.17.21');
      expect(devDeps.get('vitest')).toBe('^1.0.0');
      expect(peerDeps.get('react')).toBe('>=18');
    });
  });

  describe('ParseResult with modules', () => {
    it('should store a single module', () => {
      const result = createEmptyParseResult();
      result.modules.push(createSampleModule());

      expect(result.modules).toHaveLength(1);
      expect(result.modules[0].id).toBe('mod-1');
      expect(result.modules[0].name).toBe('TestModule');
      expect(result.modules[0].source.filename).toBe('/src/TestModule.ts');
    });

    it('should store multiple modules', () => {
      const result = createEmptyParseResult();
      result.modules.push(
        createSampleModule({ id: 'mod-1', name: 'ModuleA' }),
        createSampleModule({ id: 'mod-2', name: 'ModuleB' }),
        createSampleModule({ id: 'mod-3', name: 'ModuleC' })
      );

      expect(result.modules).toHaveLength(3);
      expect(result.modules.map((m) => m.name)).toEqual(['ModuleA', 'ModuleB', 'ModuleC']);
    });

    it('should store a module with optional line_count', () => {
      const result = createEmptyParseResult();
      const moduleWithoutLineCount = createSampleModule();
      delete moduleWithoutLineCount.line_count;
      result.modules.push(moduleWithoutLineCount);

      expect(result.modules[0].line_count).toBeUndefined();
    });
  });

  describe('ParseResult with classes', () => {
    it('should store classes', () => {
      const result = createEmptyParseResult();
      result.classes.push(createSampleClass());

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe('TestClass');
    });

    it('should store a class with an extends_id', () => {
      const result = createEmptyParseResult();
      result.classes.push(createSampleClass({ extends_id: 'parent-cls-1' }));

      expect(result.classes[0].extends_id).toBe('parent-cls-1');
    });

    it('should store a class without extends_id', () => {
      const result = createEmptyParseResult();
      result.classes.push(createSampleClass());

      expect(result.classes[0].extends_id).toBeUndefined();
    });
  });

  describe('ParseResult with interfaces', () => {
    it('should store interfaces', () => {
      const result = createEmptyParseResult();
      result.interfaces.push(createSampleInterface());

      expect(result.interfaces).toHaveLength(1);
      expect(result.interfaces[0].name).toBe('TestInterface');
      expect(result.interfaces[0].id).toBe('iface-1');
    });
  });

  describe('ParseResult with functions', () => {
    it('should store functions with all optional fields', () => {
      const result = createEmptyParseResult();
      result.functions.push(
        createSampleFunction({
          return_type: 'Promise<void>',
          is_async: true,
          is_exported: true,
          has_explicit_return_type: true,
        })
      );

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe('testFunction');
      expect(result.functions[0].return_type).toBe('Promise<void>');
      expect(result.functions[0].is_async).toBe(true);
      expect(result.functions[0].is_exported).toBe(true);
      expect(result.functions[0].has_explicit_return_type).toBe(true);
    });

    it('should store functions without optional fields', () => {
      const result = createEmptyParseResult();
      result.functions.push(createSampleFunction());

      expect(result.functions[0].return_type).toBeUndefined();
      expect(result.functions[0].is_async).toBeUndefined();
      expect(result.functions[0].is_exported).toBeUndefined();
    });
  });

  describe('ParseResult with type aliases', () => {
    it('should store type aliases', () => {
      const alias: ITypeAliasCreateDTO = {
        id: 'ta-1',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        name: 'StringOrNumber',
        type: 'string | number',
      };
      const result = createEmptyParseResult();
      result.typeAliases.push(alias);

      expect(result.typeAliases).toHaveLength(1);
      expect(result.typeAliases[0].name).toBe('StringOrNumber');
      expect(result.typeAliases[0].type).toBe('string | number');
    });

    it('should store type aliases with type_parameters_json', () => {
      const alias: ITypeAliasCreateDTO = {
        id: 'ta-2',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        name: 'Nullable',
        type: 'T | null',
        type_parameters_json: JSON.stringify([{ name: 'T' }]),
      };
      const result = createEmptyParseResult();
      result.typeAliases.push(alias);

      const json = result.typeAliases[0].type_parameters_json;
      expect(json).toBeDefined();
      const parsed: unknown = json ? JSON.parse(json) : undefined;
      expect(parsed).toEqual([{ name: 'T' }]);
    });
  });

  describe('ParseResult with enums', () => {
    it('should store enums', () => {
      const enumDTO: IEnumCreateDTO = {
        id: 'enum-1',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        name: 'Direction',
        members_json: JSON.stringify(['North', 'South', 'East', 'West']),
      };
      const result = createEmptyParseResult();
      result.enums.push(enumDTO);

      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe('Direction');
      expect(result.enums[0].members_json).toBeDefined();
    });

    it('should store enums without members', () => {
      const enumDTO: IEnumCreateDTO = {
        id: 'enum-2',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        name: 'Empty',
      };
      const result = createEmptyParseResult();
      result.enums.push(enumDTO);

      expect(result.enums[0].members_json).toBeUndefined();
    });
  });

  describe('ParseResult with variables', () => {
    it('should store const variables', () => {
      const variable: IVariableCreateDTO = {
        id: 'var-1',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        name: 'MAX_COUNT',
        kind: 'const',
        type: 'number',
        initializer: '100',
      };
      const result = createEmptyParseResult();
      result.variables.push(variable);

      expect(result.variables).toHaveLength(1);
      expect(result.variables[0].kind).toBe('const');
      expect(result.variables[0].type).toBe('number');
      expect(result.variables[0].initializer).toBe('100');
    });

    it('should store let and var declarations', () => {
      const result = createEmptyParseResult();
      result.variables.push(
        { id: 'var-1', package_id: 'pkg-1', module_id: 'mod-1', name: 'x', kind: 'let' },
        { id: 'var-2', package_id: 'pkg-1', module_id: 'mod-1', name: 'y', kind: 'var' }
      );

      expect(result.variables).toHaveLength(2);
      expect(result.variables[0].kind).toBe('let');
      expect(result.variables[1].kind).toBe('var');
    });
  });

  describe('ParseResult with methods', () => {
    it('should store class methods', () => {
      const result = createEmptyParseResult();
      result.methods.push(createSampleMethod());

      expect(result.methods).toHaveLength(1);
      expect(result.methods[0].parent_type).toBe('class');
      expect(result.methods[0].visibility).toBe('public');
    });

    it('should store interface methods', () => {
      const result = createEmptyParseResult();
      result.methods.push(
        createSampleMethod({
          id: 'meth-2',
          parent_id: 'iface-1',
          parent_type: 'interface',
          name: 'interfaceMethod',
        })
      );

      expect(result.methods[0].parent_type).toBe('interface');
      expect(result.methods[0].name).toBe('interfaceMethod');
    });

    it('should store async static methods', () => {
      const result = createEmptyParseResult();
      result.methods.push(
        createSampleMethod({
          is_async: true,
          is_static: true,
          name: 'staticAsyncMethod',
        })
      );

      expect(result.methods[0].is_async).toBe(true);
      expect(result.methods[0].is_static).toBe(true);
    });
  });

  describe('ParseResult with properties', () => {
    it('should store class properties', () => {
      const result = createEmptyParseResult();
      result.properties.push(createSampleProperty());

      expect(result.properties).toHaveLength(1);
      expect(result.properties[0].type).toBe('string');
      expect(result.properties[0].is_optional).toBe(false);
    });

    it('should store optional readonly properties', () => {
      const result = createEmptyParseResult();
      result.properties.push(
        createSampleProperty({
          is_optional: true,
          is_readonly: true,
          visibility: 'protected',
        })
      );

      expect(result.properties[0].is_optional).toBe(true);
      expect(result.properties[0].is_readonly).toBe(true);
      expect(result.properties[0].visibility).toBe('protected');
    });
  });

  describe('ParseResult with parameters', () => {
    it('should store method parameters', () => {
      const result = createEmptyParseResult();
      result.parameters.push(createSampleParameter());

      expect(result.parameters).toHaveLength(1);
      expect(result.parameters[0].name).toBe('arg');
      expect(result.parameters[0].type).toBe('string');
      expect(result.parameters[0].is_optional).toBe(false);
      expect(result.parameters[0].is_rest).toBe(false);
    });

    it('should store optional and rest parameters', () => {
      const result = createEmptyParseResult();
      result.parameters.push(
        createSampleParameter({ id: 'param-1', name: 'optional', is_optional: true, default_value: "'default'" }),
        createSampleParameter({ id: 'param-2', name: 'rest', type: 'string[]', is_rest: true })
      );

      expect(result.parameters).toHaveLength(2);
      expect(result.parameters[0].is_optional).toBe(true);
      expect(result.parameters[0].default_value).toBe("'default'");
      expect(result.parameters[1].is_rest).toBe(true);
    });
  });

  describe('ParseResult with imports and exports', () => {
    it('should store imports', () => {
      const result = createEmptyParseResult();
      const importObj = new Import('imp-uuid-1', 'react', './node_modules/react', 'react');
      result.imports.push(importObj);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].fullPath).toBe('react');
      expect(result.imports[0].name).toBe('react');
    });

    it('should store imports with specifiers', () => {
      const result = createEmptyParseResult();
      const specifiers = new Map<string, ImportSpecifier>();
      specifiers.set('useState', new ImportSpecifier('spec-1', 'useState', 'value'));
      specifiers.set('useEffect', new ImportSpecifier('spec-2', 'useEffect', 'value'));

      const importObj = new Import('imp-uuid-2', 'react', './node_modules/react', 'react', specifiers);
      result.imports.push(importObj);

      expect(result.imports[0].specifiers.size).toBe(2);
      expect(result.imports[0].specifiers.get('useState')?.kind).toBe('value');
    });

    it('should store exports', () => {
      const result = createEmptyParseResult();
      const exportObj = new Export('exp-uuid-1', 'mod-1', 'MyComponent', false);
      result.exports.push(exportObj);

      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe('MyComponent');
      expect(result.exports[0].isDefault).toBe(false);
      expect(result.exports[0].module).toBe('mod-1');
    });

    it('should store default exports', () => {
      const result = createEmptyParseResult();
      const exportObj = new Export('exp-uuid-2', 'mod-1', 'default', true);
      result.exports.push(exportObj);

      expect(result.exports[0].isDefault).toBe(true);
    });

    it('should store re-exports with exportedFrom', () => {
      const result = createEmptyParseResult();
      const exportObj = new Export('exp-uuid-3', 'mod-1', 'SomeType', false, 'SomeType', 'mod-2');
      result.exports.push(exportObj);

      expect(result.exports[0].exportedFrom).toBe('mod-2');
      expect(result.exports[0].localName).toBe('SomeType');
    });
  });

  describe('ParseResult with importsWithModules', () => {
    it('should store importsWithModules when provided', () => {
      const result = createEmptyParseResult();
      const importObj = new Import('imp-uuid-1', 'lodash', './node_modules/lodash', 'lodash');
      const entry = { import: importObj, moduleId: 'mod-1' };
      result.importsWithModules = [entry];

      expect(result.importsWithModules).toHaveLength(1);
      expect(entry.moduleId).toBe('mod-1');
      expect(entry.import.fullPath).toBe('lodash');
    });

    it('should allow multiple entries in importsWithModules', () => {
      const result = createEmptyParseResult();
      const imp1 = new Import('imp-1', 'react', './node_modules/react', 'react');
      const imp2 = new Import('imp-2', 'vue', './node_modules/vue', 'vue');
      result.importsWithModules = [
        { import: imp1, moduleId: 'mod-1' },
        { import: imp2, moduleId: 'mod-2' },
      ];

      expect(result.importsWithModules).toHaveLength(2);
    });
  });

  describe('ClassExtendsRef', () => {
    it('should store a class extends reference with just classId and parentName', () => {
      const ref: ClassExtendsRef = {
        classId: 'cls-1',
        parentName: 'BaseClass',
      };

      const result = createEmptyParseResult();
      result.classExtends.push(ref);

      expect(result.classExtends).toHaveLength(1);
      expect(result.classExtends[0].classId).toBe('cls-1');
      expect(result.classExtends[0].parentName).toBe('BaseClass');
      expect(result.classExtends[0].parentId).toBeUndefined();
    });

    it('should store a resolved class extends reference with parentId', () => {
      const ref: ClassExtendsRef = {
        classId: 'cls-1',
        parentName: 'BaseClass',
        parentId: 'cls-base',
      };

      const result = createEmptyParseResult();
      result.classExtends.push(ref);

      expect(result.classExtends[0].parentId).toBe('cls-base');
    });

    it('should store multiple class extends references', () => {
      const result = createEmptyParseResult();
      result.classExtends.push(
        { classId: 'cls-1', parentName: 'BaseA' },
        { classId: 'cls-2', parentName: 'BaseB' },
        { classId: 'cls-3', parentName: 'BaseC', parentId: 'cls-base-c' }
      );

      expect(result.classExtends).toHaveLength(3);
      expect(result.classExtends[2].parentId).toBe('cls-base-c');
    });
  });

  describe('ClassImplementsRef', () => {
    it('should store a class implements reference with just classId and interfaceName', () => {
      const ref: ClassImplementsRef = {
        classId: 'cls-1',
        interfaceName: 'Serializable',
      };

      const result = createEmptyParseResult();
      result.classImplements.push(ref);

      expect(result.classImplements).toHaveLength(1);
      expect(result.classImplements[0].classId).toBe('cls-1');
      expect(result.classImplements[0].interfaceName).toBe('Serializable');
      expect(result.classImplements[0].interfaceId).toBeUndefined();
    });

    it('should store a resolved class implements reference with interfaceId', () => {
      const ref: ClassImplementsRef = {
        classId: 'cls-1',
        interfaceName: 'Serializable',
        interfaceId: 'iface-ser',
      };

      const result = createEmptyParseResult();
      result.classImplements.push(ref);

      expect(result.classImplements[0].interfaceId).toBe('iface-ser');
    });

    it('should store multiple implements for the same class', () => {
      const result = createEmptyParseResult();
      result.classImplements.push(
        { classId: 'cls-1', interfaceName: 'Serializable' },
        { classId: 'cls-1', interfaceName: 'Disposable' },
        { classId: 'cls-1', interfaceName: 'Comparable' }
      );

      expect(result.classImplements).toHaveLength(3);
      expect(result.classImplements.every((ref) => ref.classId === 'cls-1')).toBe(true);
    });
  });

  describe('InterfaceExtendsRef', () => {
    it('should store an interface extends reference with just interfaceId and parentName', () => {
      const ref: InterfaceExtendsRef = {
        interfaceId: 'iface-1',
        parentName: 'BaseInterface',
      };

      const result = createEmptyParseResult();
      result.interfaceExtends.push(ref);

      expect(result.interfaceExtends).toHaveLength(1);
      expect(result.interfaceExtends[0].interfaceId).toBe('iface-1');
      expect(result.interfaceExtends[0].parentName).toBe('BaseInterface');
      expect(result.interfaceExtends[0].parentId).toBeUndefined();
    });

    it('should store a resolved interface extends reference with parentId', () => {
      const ref: InterfaceExtendsRef = {
        interfaceId: 'iface-1',
        parentName: 'BaseInterface',
        parentId: 'iface-base',
      };

      const result = createEmptyParseResult();
      result.interfaceExtends.push(ref);

      expect(result.interfaceExtends[0].parentId).toBe('iface-base');
    });

    it('should store multiple interface extends (multiple inheritance)', () => {
      const result = createEmptyParseResult();
      result.interfaceExtends.push(
        { interfaceId: 'iface-1', parentName: 'Readable' },
        { interfaceId: 'iface-1', parentName: 'Writable' }
      );

      expect(result.interfaceExtends).toHaveLength(2);
      expect(result.interfaceExtends.map((ref) => ref.parentName)).toEqual(['Readable', 'Writable']);
    });
  });

  describe('SymbolUsageRef', () => {
    it('should store a method symbol usage', () => {
      const usage: SymbolUsageRef = {
        moduleId: 'mod-1',
        sourceSymbolType: 'method',
        sourceSymbolName: 'doSomething',
        sourceParentName: 'MyClass',
        sourceParentType: 'class',
        targetName: 'helperMethod',
        targetKind: 'method',
      };

      const result = createEmptyParseResult();
      result.symbolUsages.push(usage);

      expect(result.symbolUsages).toHaveLength(1);
      expect(result.symbolUsages[0].targetName).toBe('helperMethod');
      expect(result.symbolUsages[0].targetKind).toBe('method');
      expect(result.symbolUsages[0].sourceSymbolType).toBe('method');
    });

    it('should store a function symbol usage', () => {
      const usage: SymbolUsageRef = {
        moduleId: 'mod-1',
        sourceSymbolType: 'function',
        sourceSymbolName: 'processData',
        targetName: 'someProperty',
        targetKind: 'property',
      };

      const result = createEmptyParseResult();
      result.symbolUsages.push(usage);

      expect(result.symbolUsages[0].sourceSymbolType).toBe('function');
      expect(result.symbolUsages[0].targetKind).toBe('property');
      expect(result.symbolUsages[0].sourceParentName).toBeUndefined();
      expect(result.symbolUsages[0].sourceParentType).toBeUndefined();
    });

    it('should store a symbol usage with qualifierName', () => {
      const usage: SymbolUsageRef = {
        moduleId: 'mod-1',
        sourceSymbolType: 'method',
        targetName: 'length',
        targetKind: 'property',
        qualifierName: 'Array',
      };

      const result = createEmptyParseResult();
      result.symbolUsages.push(usage);

      expect(result.symbolUsages[0].qualifierName).toBe('Array');
    });

    it('should store a symbol usage with sourceSymbolId', () => {
      const usage: SymbolUsageRef = {
        moduleId: 'mod-1',
        sourceSymbolId: 'meth-1',
        sourceSymbolType: 'method',
        targetName: 'toString',
        targetKind: 'method',
      };

      const result = createEmptyParseResult();
      result.symbolUsages.push(usage);

      expect(result.symbolUsages[0].sourceSymbolId).toBe('meth-1');
    });
  });

  describe('symbolReferences', () => {
    it('should store resolved symbol references', () => {
      const ref: ISymbolReferenceCreateDTO = {
        id: 'symref-1',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        source_symbol_id: 'meth-1',
        source_symbol_type: 'method',
        source_symbol_name: 'processData',
        target_symbol_id: 'prop-1',
        target_symbol_type: 'property',
        target_symbol_name: 'value',
        access_kind: 'property',
      };

      const result = createEmptyParseResult();
      result.symbolReferences.push(ref);

      expect(result.symbolReferences).toHaveLength(1);
      expect(result.symbolReferences[0].source_symbol_type).toBe('method');
      expect(result.symbolReferences[0].target_symbol_type).toBe('property');
    });

    it('should store symbol references without optional fields', () => {
      const ref: ISymbolReferenceCreateDTO = {
        id: 'symref-2',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        source_symbol_type: 'function',
        target_symbol_id: 'meth-1',
        target_symbol_type: 'method',
        target_symbol_name: 'execute',
        access_kind: 'method',
      };

      const result = createEmptyParseResult();
      result.symbolReferences.push(ref);

      expect(result.symbolReferences[0].source_symbol_id).toBeUndefined();
      expect(result.symbolReferences[0].source_symbol_name).toBeUndefined();
      expect(result.symbolReferences[0].qualifier_name).toBeUndefined();
    });

    it('should store symbol references with qualifier_name', () => {
      const ref: ISymbolReferenceCreateDTO = {
        id: 'symref-3',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        source_symbol_type: 'method',
        target_symbol_id: 'meth-2',
        target_symbol_type: 'method',
        target_symbol_name: 'push',
        access_kind: 'method',
        qualifier_name: 'Array',
      };

      const result = createEmptyParseResult();
      result.symbolReferences.push(ref);

      expect(result.symbolReferences[0].qualifier_name).toBe('Array');
    });
  });

  describe('fully populated ParseResult', () => {
    it('should hold all entity types simultaneously', () => {
      const result: ParseResult = {
        package: createSamplePackage(),
        modules: [createSampleModule()],
        classes: [createSampleClass()],
        interfaces: [createSampleInterface()],
        functions: [createSampleFunction()],
        typeAliases: [
          {
            id: 'ta-1',
            package_id: 'pkg-1',
            module_id: 'mod-1',
            name: 'ID',
            type: 'string',
          },
        ],
        enums: [
          {
            id: 'enum-1',
            package_id: 'pkg-1',
            module_id: 'mod-1',
            name: 'Status',
          },
        ],
        variables: [
          {
            id: 'var-1',
            package_id: 'pkg-1',
            module_id: 'mod-1',
            name: 'VERSION',
            kind: 'const',
          },
        ],
        methods: [createSampleMethod()],
        properties: [createSampleProperty()],
        parameters: [createSampleParameter()],
        imports: [new Import('imp-1', 'react', './node_modules/react', 'react')],
        exports: [new Export('exp-1', 'mod-1', 'TestClass', false)],
        classExtends: [{ classId: 'cls-1', parentName: 'BaseClass' }],
        classImplements: [{ classId: 'cls-1', interfaceName: 'TestInterface' }],
        interfaceExtends: [{ interfaceId: 'iface-1', parentName: 'BaseInterface' }],
        symbolUsages: [
          {
            moduleId: 'mod-1',
            sourceSymbolType: 'method',
            targetName: 'helper',
            targetKind: 'method',
          },
        ],
        symbolReferences: [
          {
            id: 'symref-1',
            package_id: 'pkg-1',
            module_id: 'mod-1',
            source_symbol_type: 'method',
            target_symbol_id: 'meth-1',
            target_symbol_type: 'method',
            target_symbol_name: 'helper',
            access_kind: 'method',
          },
        ],
      };

      expect(result.package).toBeDefined();
      expect(result.modules).toHaveLength(1);
      expect(result.classes).toHaveLength(1);
      expect(result.interfaces).toHaveLength(1);
      expect(result.functions).toHaveLength(1);
      expect(result.typeAliases).toHaveLength(1);
      expect(result.enums).toHaveLength(1);
      expect(result.variables).toHaveLength(1);
      expect(result.methods).toHaveLength(1);
      expect(result.properties).toHaveLength(1);
      expect(result.parameters).toHaveLength(1);
      expect(result.imports).toHaveLength(1);
      expect(result.exports).toHaveLength(1);
      expect(result.classExtends).toHaveLength(1);
      expect(result.classImplements).toHaveLength(1);
      expect(result.interfaceExtends).toHaveLength(1);
      expect(result.symbolUsages).toHaveLength(1);
      expect(result.symbolReferences).toHaveLength(1);
    });

    it('should hold large numbers of entities', () => {
      const result = createEmptyParseResult();

      for (let i = 0; i < 100; i++) {
        const idx = String(i);
        result.classes.push(createSampleClass({ id: 'cls-' + idx, name: 'Class' + idx }));
        result.methods.push(
          createSampleMethod({
            id: 'meth-' + idx,
            parent_id: 'cls-' + idx,
            name: 'method' + idx,
          })
        );
      }

      expect(result.classes).toHaveLength(100);
      expect(result.methods).toHaveLength(100);
      expect(result.classes[99].name).toBe('Class99');
      expect(result.methods[99].parent_id).toBe('cls-99');
    });
  });

  describe('merging two ParseResult objects', () => {
    it('should allow concatenation of arrays from two results', () => {
      const result1 = createEmptyParseResult();
      result1.classes.push(createSampleClass({ id: 'cls-1', name: 'ClassA' }));
      result1.modules.push(createSampleModule({ id: 'mod-1', name: 'ModuleA' }));

      const result2 = createEmptyParseResult();
      result2.classes.push(createSampleClass({ id: 'cls-2', name: 'ClassB' }));
      result2.modules.push(createSampleModule({ id: 'mod-2', name: 'ModuleB' }));

      const merged: ParseResult = {
        ...createEmptyParseResult(),
        modules: [...result1.modules, ...result2.modules],
        classes: [...result1.classes, ...result2.classes],
        interfaces: [...result1.interfaces, ...result2.interfaces],
        functions: [...result1.functions, ...result2.functions],
        typeAliases: [...result1.typeAliases, ...result2.typeAliases],
        enums: [...result1.enums, ...result2.enums],
        variables: [...result1.variables, ...result2.variables],
        methods: [...result1.methods, ...result2.methods],
        properties: [...result1.properties, ...result2.properties],
        parameters: [...result1.parameters, ...result2.parameters],
        imports: [...result1.imports, ...result2.imports],
        exports: [...result1.exports, ...result2.exports],
        classExtends: [...result1.classExtends, ...result2.classExtends],
        classImplements: [...result1.classImplements, ...result2.classImplements],
        interfaceExtends: [...result1.interfaceExtends, ...result2.interfaceExtends],
        symbolUsages: [...result1.symbolUsages, ...result2.symbolUsages],
        symbolReferences: [...result1.symbolReferences, ...result2.symbolReferences],
      };

      expect(merged.modules).toHaveLength(2);
      expect(merged.classes).toHaveLength(2);
      expect(merged.modules.map((m) => m.name)).toEqual(['ModuleA', 'ModuleB']);
      expect(merged.classes.map((c) => c.name)).toEqual(['ClassA', 'ClassB']);
    });
  });

  describe('deferred resolution pattern', () => {
    it('should support the deferred name-to-UUID resolution workflow', () => {
      // Step 1: Parser creates refs with names only (no IDs yet)
      const result = createEmptyParseResult();
      result.classes.push(
        createSampleClass({ id: 'cls-child', name: 'ChildClass' }),
        createSampleClass({ id: 'cls-parent', name: 'ParentClass' })
      );
      result.classExtends.push({
        classId: 'cls-child',
        parentName: 'ParentClass',
      });

      expect(result.classExtends[0].parentId).toBeUndefined();

      // Step 2: Simulate resolution — we know the parent was added with id 'cls-parent'
      const parentClass = result.classes.find((c) => c.name === 'ParentClass');
      expect(parentClass).toBeDefined();

      // Use the known id directly (mirrors how PackageParser resolves by lookup)
      result.classExtends[0].parentId = 'cls-parent';

      expect(result.classExtends[0].parentId).toBe('cls-parent');
    });

    it('should support resolving class implements references', () => {
      const result = createEmptyParseResult();
      result.classes.push(createSampleClass({ id: 'cls-impl', name: 'MyService' }));
      result.interfaces.push(createSampleInterface({ id: 'iface-svc', name: 'IService' }));
      result.classImplements.push({
        classId: 'cls-impl',
        interfaceName: 'IService',
      });

      expect(result.classImplements[0].interfaceId).toBeUndefined();

      const iface = result.interfaces.find((i) => i.name === 'IService');
      expect(iface).toBeDefined();
      result.classImplements[0].interfaceId = 'iface-svc';

      expect(result.classImplements[0].interfaceId).toBe('iface-svc');
    });

    it('should support resolving interface extends references', () => {
      const result = createEmptyParseResult();
      result.interfaces.push(
        createSampleInterface({ id: 'iface-child', name: 'ReadWriteStream' }),
        createSampleInterface({ id: 'iface-parent', name: 'ReadableStream' })
      );
      result.interfaceExtends.push({
        interfaceId: 'iface-child',
        parentName: 'ReadableStream',
      });

      expect(result.interfaceExtends[0].parentId).toBeUndefined();

      const parent = result.interfaces.find((i) => i.name === 'ReadableStream');
      expect(parent).toBeDefined();
      result.interfaceExtends[0].parentId = 'iface-parent';

      expect(result.interfaceExtends[0].parentId).toBe('iface-parent');
    });
  });

  describe('edge cases', () => {
    it('should handle classes with empty string names', () => {
      const result = createEmptyParseResult();
      result.classes.push(createSampleClass({ name: '' }));

      expect(result.classes[0].name).toBe('');
    });

    it('should handle modules with minimal source information', () => {
      const result = createEmptyParseResult();
      result.modules.push({
        id: 'mod-min',
        package_id: 'pkg-1',
        name: 'Minimal',
        source: {
          directory: '/',
          name: 'Minimal',
          filename: '/Minimal.ts',
          relativePath: 'Minimal.ts',
        },
      });

      expect(result.modules[0].line_count).toBeUndefined();
    });

    it('should handle symbol usage with all optional fields undefined', () => {
      const usage: SymbolUsageRef = {
        moduleId: 'mod-1',
        sourceSymbolType: 'function',
        targetName: 'target',
        targetKind: 'method',
      };

      expect(usage.sourceSymbolId).toBeUndefined();
      expect(usage.sourceSymbolName).toBeUndefined();
      expect(usage.sourceParentName).toBeUndefined();
      expect(usage.sourceParentType).toBeUndefined();
      expect(usage.qualifierName).toBeUndefined();
    });

    it('should allow mutating arrays in place (push pattern used by parser)', () => {
      const result = createEmptyParseResult();

      // This mirrors how ModuleParser builds up the result
      result.classes.push(createSampleClass());
      result.methods.push(createSampleMethod());
      result.properties.push(createSampleProperty());
      result.parameters.push(createSampleParameter());

      expect(result.classes).toHaveLength(1);
      expect(result.methods).toHaveLength(1);
      expect(result.properties).toHaveLength(1);
      expect(result.parameters).toHaveLength(1);
    });

    it('should allow reassigning the package field', () => {
      const result = createEmptyParseResult();
      expect(result.package).toBeUndefined();

      result.package = createSamplePackage();
      expect(result.package).toBeDefined();

      result.package = undefined;
      expect(result.package).toBeUndefined();
    });
  });
});
