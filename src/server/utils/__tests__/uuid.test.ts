import {
  generateUUID,
  generateClassUUID,
  generateInterfaceUUID,
  generatePackageUUID,
  generateMethodUUID,
  generatePropertyUUID,
  generateParameterUUID,
  generateModuleUUID,
  generateEnumUUID,
  generateExportUUID,
  generateImportUUID,
  generateTypeAliasUUID,
  generateVariableUUID,
  generateModuleDefinitionUUID,
  generateFunctionUUID,
  generateCodeIssueUUID,
  generateRelationshipUUID,
} from '../uuid';

// UUID v5 format regex: 8-4-4-4-12 hex chars with version nibble = 5
const UUID_V5_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateUUID', () => {
  it('returns a valid UUID v5 string', () => {
    const result = generateUUID('class', 'test-key');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same type and key', () => {
    const first = generateUUID('class', 'my-class-key');
    const second = generateUUID('class', 'my-class-key');
    expect(first).toBe(second);
  });

  it('returns different UUIDs for different keys with the same type', () => {
    const a = generateUUID('class', 'key-a');
    const b = generateUUID('class', 'key-b');
    expect(a).not.toBe(b);
  });

  it('returns different UUIDs for the same key with different types', () => {
    const classUUID = generateUUID('class', 'shared-key');
    const interfaceUUID = generateUUID('interface', 'shared-key');
    expect(classUUID).not.toBe(interfaceUUID);
  });

  it('handles empty string key', () => {
    const result = generateUUID('class', '');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('handles key with special characters', () => {
    const result = generateUUID('class', 'path/to/file.ts::ClassName<T>');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('handles key with unicode characters', () => {
    const result = generateUUID('class', 'MyClass-\u00e9\u00e8\u00ea');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('produces distinct UUIDs for every entity type namespace', () => {
    const types = [
      'class',
      'interface',
      'package',
      'method',
      'property',
      'parameter',
      'module',
      'enum',
      'function',
      'export',
      'import',
      'typeAlias',
      'variable',
      'moduleDefinition',
      'codeIssue',
    ] as const;

    const uuids = types.map((type) => generateUUID(type, 'same-key'));
    const uniqueUUIDs = new Set(uuids);
    expect(uniqueUUIDs.size).toBe(types.length);
  });
});

describe('generateClassUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generateClassUUID('pkg-1', 'mod-1', 'MyClass');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generateClassUUID('pkg-1', 'mod-1', 'MyClass');
    const second = generateClassUUID('pkg-1', 'mod-1', 'MyClass');
    expect(first).toBe(second);
  });

  it('returns different UUID when packageId differs', () => {
    const a = generateClassUUID('pkg-1', 'mod-1', 'MyClass');
    const b = generateClassUUID('pkg-2', 'mod-1', 'MyClass');
    expect(a).not.toBe(b);
  });

  it('returns different UUID when moduleId differs', () => {
    const a = generateClassUUID('pkg-1', 'mod-1', 'MyClass');
    const b = generateClassUUID('pkg-1', 'mod-2', 'MyClass');
    expect(a).not.toBe(b);
  });

  it('returns different UUID when name differs', () => {
    const a = generateClassUUID('pkg-1', 'mod-1', 'ClassA');
    const b = generateClassUUID('pkg-1', 'mod-1', 'ClassB');
    expect(a).not.toBe(b);
  });

  it('constructs key as packageId.moduleId.name', () => {
    const direct = generateUUID('class', 'pkg-1.mod-1.MyClass');
    const helper = generateClassUUID('pkg-1', 'mod-1', 'MyClass');
    expect(helper).toBe(direct);
  });
});

describe('generateInterfaceUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generateInterfaceUUID('pkg-1', 'mod-1', 'MyInterface');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generateInterfaceUUID('pkg-1', 'mod-1', 'IFoo');
    const second = generateInterfaceUUID('pkg-1', 'mod-1', 'IFoo');
    expect(first).toBe(second);
  });

  it('constructs key as packageId.moduleId.name using interface namespace', () => {
    const direct = generateUUID('interface', 'pkg-1.mod-1.IFoo');
    const helper = generateInterfaceUUID('pkg-1', 'mod-1', 'IFoo');
    expect(helper).toBe(direct);
  });

  it('differs from class UUID with same arguments', () => {
    const classId = generateClassUUID('pkg-1', 'mod-1', 'Foo');
    const interfaceId = generateInterfaceUUID('pkg-1', 'mod-1', 'Foo');
    expect(classId).not.toBe(interfaceId);
  });
});

describe('generatePackageUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generatePackageUUID('my-package', '1.0.0');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generatePackageUUID('my-package', '1.0.0');
    const second = generatePackageUUID('my-package', '1.0.0');
    expect(first).toBe(second);
  });

  it('returns different UUID for different versions', () => {
    const a = generatePackageUUID('my-package', '1.0.0');
    const b = generatePackageUUID('my-package', '2.0.0');
    expect(a).not.toBe(b);
  });

  it('constructs key as name@version', () => {
    const direct = generateUUID('package', 'my-package@1.0.0');
    const helper = generatePackageUUID('my-package', '1.0.0');
    expect(helper).toBe(direct);
  });

  it('handles scoped package names', () => {
    const result = generatePackageUUID('@scope/my-package', '1.0.0');
    expect(result).toMatch(UUID_V5_REGEX);
  });
});

describe('generateMethodUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generateMethodUUID('pkg-1', 'mod-1', 'class-1', 'doSomething');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generateMethodUUID('pkg-1', 'mod-1', 'class-1', 'run');
    const second = generateMethodUUID('pkg-1', 'mod-1', 'class-1', 'run');
    expect(first).toBe(second);
  });

  it('constructs key as packageId.moduleId.parentId.name', () => {
    const direct = generateUUID('method', 'pkg-1.mod-1.class-1.run');
    const helper = generateMethodUUID('pkg-1', 'mod-1', 'class-1', 'run');
    expect(helper).toBe(direct);
  });

  it('returns different UUID when parentId differs', () => {
    const a = generateMethodUUID('pkg-1', 'mod-1', 'class-A', 'run');
    const b = generateMethodUUID('pkg-1', 'mod-1', 'class-B', 'run');
    expect(a).not.toBe(b);
  });
});

describe('generatePropertyUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generatePropertyUUID('pkg-1', 'mod-1', 'class-1', 'myProp', 'class');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generatePropertyUUID('pkg-1', 'mod-1', 'class-1', 'name', 'class');
    const second = generatePropertyUUID('pkg-1', 'mod-1', 'class-1', 'name', 'class');
    expect(first).toBe(second);
  });

  it('constructs key as packageId.moduleId.parentId.parentType.name', () => {
    const direct = generateUUID('property', 'pkg-1.mod-1.class-1.class.name');
    const helper = generatePropertyUUID('pkg-1', 'mod-1', 'class-1', 'name', 'class');
    expect(helper).toBe(direct);
  });

  it('returns different UUID for class vs interface parentType', () => {
    const classProp = generatePropertyUUID('pkg-1', 'mod-1', 'parent-1', 'name', 'class');
    const interfaceProp = generatePropertyUUID('pkg-1', 'mod-1', 'parent-1', 'name', 'interface');
    expect(classProp).not.toBe(interfaceProp);
  });
});

describe('generateParameterUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generateParameterUUID('method-1', 'arg0');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generateParameterUUID('method-1', 'arg0');
    const second = generateParameterUUID('method-1', 'arg0');
    expect(first).toBe(second);
  });

  it('constructs key as methodId.name', () => {
    const direct = generateUUID('parameter', 'method-1.arg0');
    const helper = generateParameterUUID('method-1', 'arg0');
    expect(helper).toBe(direct);
  });
});

describe('generateModuleUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generateModuleUUID('pkg-1', 'src/index.ts');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generateModuleUUID('pkg-1', 'src/utils.ts');
    const second = generateModuleUUID('pkg-1', 'src/utils.ts');
    expect(first).toBe(second);
  });

  it('constructs key as packageId.modulePath', () => {
    const direct = generateUUID('module', 'pkg-1.src/index.ts');
    const helper = generateModuleUUID('pkg-1', 'src/index.ts');
    expect(helper).toBe(direct);
  });

  it('returns different UUID for different module paths', () => {
    const a = generateModuleUUID('pkg-1', 'src/a.ts');
    const b = generateModuleUUID('pkg-1', 'src/b.ts');
    expect(a).not.toBe(b);
  });
});

describe('generateEnumUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generateEnumUUID('pkg-1', 'mod-1', 'Status');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generateEnumUUID('pkg-1', 'mod-1', 'Direction');
    const second = generateEnumUUID('pkg-1', 'mod-1', 'Direction');
    expect(first).toBe(second);
  });

  it('constructs key as packageId.moduleId.name using enum namespace', () => {
    const direct = generateUUID('enum', 'pkg-1.mod-1.Direction');
    const helper = generateEnumUUID('pkg-1', 'mod-1', 'Direction');
    expect(helper).toBe(direct);
  });
});

describe('generateExportUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generateExportUUID('mod-1', 'default');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generateExportUUID('mod-1', 'myExport');
    const second = generateExportUUID('mod-1', 'myExport');
    expect(first).toBe(second);
  });

  it('constructs key as moduleId.exportName', () => {
    const direct = generateUUID('export', 'mod-1.default');
    const helper = generateExportUUID('mod-1', 'default');
    expect(helper).toBe(direct);
  });
});

describe('generateImportUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generateImportUUID('mod-1', 'React');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generateImportUUID('mod-1', 'React');
    const second = generateImportUUID('mod-1', 'React');
    expect(first).toBe(second);
  });

  it('constructs key as moduleId.importName', () => {
    const direct = generateUUID('import', 'mod-1.React');
    const helper = generateImportUUID('mod-1', 'React');
    expect(helper).toBe(direct);
  });
});

describe('generateTypeAliasUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generateTypeAliasUUID('pkg-1', 'mod-1', 'MyType');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generateTypeAliasUUID('pkg-1', 'mod-1', 'Props');
    const second = generateTypeAliasUUID('pkg-1', 'mod-1', 'Props');
    expect(first).toBe(second);
  });

  it('constructs key as packageId.moduleId.name using typeAlias namespace', () => {
    const direct = generateUUID('typeAlias', 'pkg-1.mod-1.Props');
    const helper = generateTypeAliasUUID('pkg-1', 'mod-1', 'Props');
    expect(helper).toBe(direct);
  });
});

describe('generateVariableUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generateVariableUUID('pkg-1', 'mod-1', 'config');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generateVariableUUID('pkg-1', 'mod-1', 'MAX_SIZE');
    const second = generateVariableUUID('pkg-1', 'mod-1', 'MAX_SIZE');
    expect(first).toBe(second);
  });

  it('constructs key as packageId.moduleId.name using variable namespace', () => {
    const direct = generateUUID('variable', 'pkg-1.mod-1.MAX_SIZE');
    const helper = generateVariableUUID('pkg-1', 'mod-1', 'MAX_SIZE');
    expect(helper).toBe(direct);
  });
});

describe('generateModuleDefinitionUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generateModuleDefinitionUUID('mod-1', 'myModule');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generateModuleDefinitionUUID('mod-1', 'myModule');
    const second = generateModuleDefinitionUUID('mod-1', 'myModule');
    expect(first).toBe(second);
  });

  it('constructs key as moduleId.name using moduleDefinition namespace', () => {
    const direct = generateUUID('moduleDefinition', 'mod-1.myModule');
    const helper = generateModuleDefinitionUUID('mod-1', 'myModule');
    expect(helper).toBe(direct);
  });
});

describe('generateFunctionUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generateFunctionUUID('pkg-1', 'mod-1', 'doWork');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generateFunctionUUID('pkg-1', 'mod-1', 'doWork');
    const second = generateFunctionUUID('pkg-1', 'mod-1', 'doWork');
    expect(first).toBe(second);
  });

  it('constructs key as packageId.moduleId.name using function namespace', () => {
    const direct = generateUUID('function', 'pkg-1.mod-1.doWork');
    const helper = generateFunctionUUID('pkg-1', 'mod-1', 'doWork');
    expect(helper).toBe(direct);
  });
});

describe('generateCodeIssueUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generateCodeIssueUUID('mod-1', 'no-unused-vars', 'myVar');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generateCodeIssueUUID('mod-1', 'no-unused-vars', 'myVar');
    const second = generateCodeIssueUUID('mod-1', 'no-unused-vars', 'myVar');
    expect(first).toBe(second);
  });

  it('constructs key as moduleId:ruleCode:entityKey using colon separator', () => {
    const direct = generateUUID('codeIssue', 'mod-1:no-unused-vars:myVar');
    const helper = generateCodeIssueUUID('mod-1', 'no-unused-vars', 'myVar');
    expect(helper).toBe(direct);
  });

  it('returns different UUID for different rule codes', () => {
    const a = generateCodeIssueUUID('mod-1', 'no-unused-vars', 'myVar');
    const b = generateCodeIssueUUID('mod-1', 'no-explicit-any', 'myVar');
    expect(a).not.toBe(b);
  });
});

describe('generateRelationshipUUID', () => {
  it('returns a valid UUID v5', () => {
    const result = generateRelationshipUUID('source-id', 'target-id', 'extends');
    expect(result).toMatch(UUID_V5_REGEX);
  });

  it('returns consistent UUID for the same inputs', () => {
    const first = generateRelationshipUUID('source-id', 'target-id', 'implements');
    const second = generateRelationshipUUID('source-id', 'target-id', 'implements');
    expect(first).toBe(second);
  });

  it('constructs key as rel:type:sourceId:targetId using class namespace', () => {
    const direct = generateUUID('class', 'rel:extends:source-id:target-id');
    const helper = generateRelationshipUUID('source-id', 'target-id', 'extends');
    expect(helper).toBe(direct);
  });

  it('returns different UUID when source and target are swapped', () => {
    const forward = generateRelationshipUUID('A', 'B', 'extends');
    const reverse = generateRelationshipUUID('B', 'A', 'extends');
    expect(forward).not.toBe(reverse);
  });

  it('returns different UUID for different relationship types', () => {
    const ext = generateRelationshipUUID('A', 'B', 'extends');
    const impl = generateRelationshipUUID('A', 'B', 'implements');
    expect(ext).not.toBe(impl);
  });

  it('handles empty string arguments', () => {
    const result = generateRelationshipUUID('', '', '');
    expect(result).toMatch(UUID_V5_REGEX);
  });
});
