import jscodeshift from 'jscodeshift';

import { typeUnionWithoutAlias } from '../typeUnionWithoutAlias';

import type { IClassCreateDTO } from '../../../db/repositories/ClassRepository';
import type { IInterfaceCreateDTO } from '../../../db/repositories/InterfaceRepository';
import type { IPropertyCreateDTO } from '../../../db/repositories/PropertyRepository';
import type { ParseResult } from '../../../parsers/ParseResult';
import type { CodeIssue, RuleContext } from '../../Rule';
import type { RulesConfig } from '../../RulesConfig';

const j = jscodeshift.withParser('tsx');

const MODULE_ID = 'mod-1';
const PACKAGE_ID = 'pkg-1';
const FILE_PATH = 'src/example.ts';

function emptyParseResult(): ParseResult {
  return {
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

function defaultConfig(memberThreshold = 3): RulesConfig {
  return {
    typeUnionWithoutAlias: {
      memberThreshold,
    },
  };
}

function makeContext(
  sourceContent: string,
  overrides: {
    parseResult?: Partial<ParseResult>;
    config?: RulesConfig;
  } = {}
): RuleContext {
  const root = j(sourceContent);
  const parseResult: ParseResult = {
    ...emptyParseResult(),
    ...overrides.parseResult,
  };
  return {
    j,
    root,
    parseResult,
    packageId: PACKAGE_ID,
    moduleId: MODULE_ID,
    filePath: FILE_PATH,
    sourceContent,
    config: overrides.config ?? defaultConfig(),
  };
}

function makeInterfaceDTO(name: string, id = `iface-${name}`): IInterfaceCreateDTO {
  return {
    id,
    package_id: PACKAGE_ID,
    module_id: MODULE_ID,
    name,
  };
}

function makeClassDTO(name: string, id = `class-${name}`): IClassCreateDTO {
  return {
    id,
    package_id: PACKAGE_ID,
    module_id: MODULE_ID,
    name,
  };
}

function makePropertyDTO(
  name: string,
  parentId: string,
  parentType: 'class' | 'interface',
  id = `prop-${parentId}-${name}`
): IPropertyCreateDTO {
  return {
    id,
    package_id: PACKAGE_ID,
    module_id: MODULE_ID,
    parent_id: parentId,
    parent_type: parentType,
    name,
    type: 'string',
    is_static: false,
    is_readonly: false,
    visibility: 'public',
  };
}

// ---------------------------------------------------------------------------
// Rule metadata
// ---------------------------------------------------------------------------

describe('typeUnionWithoutAlias rule metadata', () => {
  it('has the correct code', () => {
    expect(typeUnionWithoutAlias.code).toBe('type-union-without-alias');
  });

  it('has the correct name', () => {
    expect(typeUnionWithoutAlias.name).toBe('Type Union Without Type Alias');
  });

  it('has severity "warning"', () => {
    expect(typeUnionWithoutAlias.severity).toBe('warning');
  });

  it('has a description', () => {
    expect(typeUnionWithoutAlias.description).toBeTruthy();
  });

  it('has a check function', () => {
    expect(typeof typeUnionWithoutAlias.check).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Empty / no-union inputs
// ---------------------------------------------------------------------------

describe('typeUnionWithoutAlias.check with no unions', () => {
  it('returns empty array for empty source', () => {
    const context = makeContext('');
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });

  it('returns empty array when source has no interfaces or classes', () => {
    const source = `const x = 42;\nfunction foo() { return "bar"; }`;
    const context = makeContext(source);
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });

  it('returns empty array for interface with simple typed properties', () => {
    const source = `
interface Config {
  name: string;
  count: number;
  active: boolean;
}`;
    const ifaceDTO = makeInterfaceDTO('Config');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });

  it('returns empty array for class with simple typed properties', () => {
    const source = `
class Widget {
  name: string;
  size: number;
}`;
    const classDTO = makeClassDTO('Widget');
    const context = makeContext(source, {
      parseResult: { classes: [classDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });

  it('returns empty array when interface DTO is not in parseResult', () => {
    const source = `
interface Missing {
  value: string | number | boolean;
}`;
    // No interface DTO provided -- the rule should bail out
    const context = makeContext(source);
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });

  it('returns empty array when class DTO is not in parseResult', () => {
    const source = `
class Missing {
  value: string | number | boolean;
}`;
    // No class DTO provided
    const context = makeContext(source);
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Under-threshold unions
// ---------------------------------------------------------------------------

describe('typeUnionWithoutAlias.check with unions below threshold', () => {
  it('returns empty array for union with 2 members when threshold is 3', () => {
    const source = `
interface Options {
  mode: "light" | "dark";
}`;
    const ifaceDTO = makeInterfaceDTO('Options');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
      config: defaultConfig(3),
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });

  it('returns empty array for union with exactly threshold minus one members', () => {
    const source = `
interface Flags {
  status: "on" | "off" | "pending" | "error";
}`;
    const ifaceDTO = makeInterfaceDTO('Flags');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
      config: defaultConfig(5), // threshold 5 => 4 members is below
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Interface property detections
// ---------------------------------------------------------------------------

describe('typeUnionWithoutAlias.check detecting interface property unions', () => {
  it('detects inline union with 3 members at default threshold', () => {
    const source = `
interface Config {
  mode: "a" | "b" | "c";
}`;
    const ifaceDTO = makeInterfaceDTO('Config');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule_code).toBe('type-union-without-alias');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].entity_name).toBe('mode');
    expect(issues[0].parent_entity_type).toBe('interface');
    expect(issues[0].parent_entity_name).toBe('Config');
  });

  it('includes the correct suggestion with PascalCase property name', () => {
    const source = `
interface MyWidget {
  colorScheme: "red" | "green" | "blue";
}`;
    const ifaceDTO = makeInterfaceDTO('MyWidget');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).toBe("Extract to type alias 'MyWidgetColorScheme'");
  });

  it('includes union member texts in refactor_context', () => {
    const source = `
interface Config {
  state: "active" | "inactive" | "pending";
}`;
    const ifaceDTO = makeInterfaceDTO('Config');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    const refCtx = issues[0].refactor_context as Record<string, unknown>;
    expect(refCtx.suggestedName).toBe('ConfigState');
    expect(refCtx.parentName).toBe('Config');
    expect(refCtx.parentType).toBe('interface');
    expect(refCtx.propertyName).toBe('state');
    expect(refCtx.unionMembers).toEqual(['"active"', '"inactive"', '"pending"']);
  });

  it('detects multiple properties with unions on the same interface', () => {
    const source = `
interface MultiProp {
  format: "json" | "xml" | "csv";
  size: "small" | "medium" | "large";
}`;
    const ifaceDTO = makeInterfaceDTO('MultiProp');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(2);
    const names = issues.map((i) => i.entity_name);
    expect(names).toContain('format');
    expect(names).toContain('size');
  });

  it('skips interface properties that are not TSPropertySignature', () => {
    // Methods in an interface are TSMethodSignature, not TSPropertySignature
    const source = `
interface WithMethod {
  value: "a" | "b" | "c";
  doWork(): void;
}`;
    const ifaceDTO = makeInterfaceDTO('WithMethod');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].entity_name).toBe('value');
  });

  it('sets entity_id when property DTO is found in parseResult', () => {
    const source = `
interface Item {
  kind: "book" | "movie" | "album";
}`;
    const ifaceDTO = makeInterfaceDTO('Item');
    const propDTO = makePropertyDTO('kind', ifaceDTO.id, 'interface', 'prop-kind-123');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO], properties: [propDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].entity_id).toBe('prop-kind-123');
  });

  it('omits entity_id when property DTO is not found in parseResult', () => {
    const source = `
interface Item {
  kind: "book" | "movie" | "album";
}`;
    const ifaceDTO = makeInterfaceDTO('Item');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].entity_id).toBeUndefined();
  });

  it('includes line and column from the AST node location', () => {
    const source = `
interface Located {
  status: "on" | "off" | "standby";
}`;
    const ifaceDTO = makeInterfaceDTO('Located');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    // jscodeshift provides 1-based line numbers
    expect(issues[0].line).toBeGreaterThanOrEqual(1);
    expect(issues[0].column).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Class property detections
// ---------------------------------------------------------------------------

describe('typeUnionWithoutAlias.check detecting class property unions', () => {
  it('detects inline union on a class property', () => {
    const source = `
class Logger {
  level: "info" | "warn" | "error";
}`;
    const classDTO = makeClassDTO('Logger');
    const context = makeContext(source, {
      parseResult: { classes: [classDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].entity_name).toBe('level');
    expect(issues[0].parent_entity_type).toBe('class');
    expect(issues[0].parent_entity_name).toBe('Logger');
  });

  it('includes suggestion with PascalCase name for class property', () => {
    const source = `
class Theme {
  bgColor: "red" | "blue" | "green";
}`;
    const classDTO = makeClassDTO('Theme');
    const context = makeContext(source, {
      parseResult: { classes: [classDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).toBe("Extract to type alias 'ThemeBgColor'");
  });

  it('detects multiple class properties with unions', () => {
    const source = `
class Panel {
  alignment: "left" | "center" | "right";
  border: "solid" | "dashed" | "dotted";
}`;
    const classDTO = makeClassDTO('Panel');
    const context = makeContext(source, {
      parseResult: { classes: [classDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(2);
  });

  it('sets entity_id when class property DTO exists', () => {
    const source = `
class Device {
  status: "on" | "off" | "sleep";
}`;
    const classDTO = makeClassDTO('Device');
    const propDTO = makePropertyDTO('status', classDTO.id, 'class', 'prop-status-456');
    const context = makeContext(source, {
      parseResult: { classes: [classDTO], properties: [propDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].entity_id).toBe('prop-status-456');
  });

  it('skips class methods (not ClassProperty)', () => {
    const source = `
class Worker {
  status: "idle" | "busy" | "done";
  run() { return; }
}`;
    const classDTO = makeClassDTO('Worker');
    const context = makeContext(source, {
      parseResult: { classes: [classDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].entity_name).toBe('status');
  });

  it('skips class with computed property keys', () => {
    const source = `
class Dynamic {
  [Symbol.iterator]: "a" | "b" | "c";
  normal: "x" | "y" | "z";
}`;
    const classDTO = makeClassDTO('Dynamic');
    const context = makeContext(source, {
      parseResult: { classes: [classDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    // Only the "normal" property should be detected (Identifier key)
    expect(issues).toHaveLength(1);
    expect(issues[0].entity_name).toBe('normal');
  });
});

// ---------------------------------------------------------------------------
// Threshold configuration
// ---------------------------------------------------------------------------

describe('typeUnionWithoutAlias.check with custom thresholds', () => {
  it('detects union with 2 members when threshold is 2', () => {
    const source = `
interface Opts {
  flag: "yes" | "no";
}`;
    const ifaceDTO = makeInterfaceDTO('Opts');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
      config: defaultConfig(2),
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
  });

  it('does not detect union with 3 members when threshold is 4', () => {
    const source = `
interface Opts {
  mode: "a" | "b" | "c";
}`;
    const ifaceDTO = makeInterfaceDTO('Opts');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
      config: defaultConfig(4),
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });

  it('detects exactly at threshold boundary', () => {
    const source = `
interface Boundary {
  val: "a" | "b" | "c" | "d" | "e";
}`;
    const ifaceDTO = makeInterfaceDTO('Boundary');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
      config: defaultConfig(5), // exactly 5 members, threshold 5
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
  });

  it('does not detect at one below threshold', () => {
    const source = `
interface JustUnder {
  val: "a" | "b" | "c" | "d";
}`;
    const ifaceDTO = makeInterfaceDTO('JustUnder');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
      config: defaultConfig(5), // 4 members < 5
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Mixed scenarios
// ---------------------------------------------------------------------------

describe('typeUnionWithoutAlias.check with mixed interfaces and classes', () => {
  it('detects unions across both interfaces and classes in the same source', () => {
    const source = `
interface Settings {
  theme: "light" | "dark" | "auto";
}
class AppConfig {
  logLevel: "debug" | "info" | "warn";
}`;
    const ifaceDTO = makeInterfaceDTO('Settings');
    const classDTO = makeClassDTO('AppConfig');
    const context = makeContext(source, {
      parseResult: {
        interfaces: [ifaceDTO],
        classes: [classDTO],
      },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(2);

    const ifaceIssue = issues.find((i) => i.parent_entity_name === 'Settings');
    const classIssue = issues.find((i) => i.parent_entity_name === 'AppConfig');
    expect(ifaceIssue).toBeDefined();
    expect(classIssue).toBeDefined();
    expect(ifaceIssue!.parent_entity_type).toBe('interface');
    expect(classIssue!.parent_entity_type).toBe('class');
  });

  it('only flags properties over threshold in a mixed scenario', () => {
    const source = `
interface Partial {
  twoMembers: "a" | "b";
  threeMembers: "x" | "y" | "z";
}`;
    const ifaceDTO = makeInterfaceDTO('Partial');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
      config: defaultConfig(3),
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].entity_name).toBe('threeMembers');
  });
});

// ---------------------------------------------------------------------------
// Issue structure
// ---------------------------------------------------------------------------

describe('typeUnionWithoutAlias.check issue structure', () => {
  it('populates all required CodeIssue fields', () => {
    const source = `
interface Full {
  value: string | number | boolean;
}`;
    const ifaceDTO = makeInterfaceDTO('Full');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);

    const issue: CodeIssue = issues[0];
    expect(issue.id).toBeTruthy();
    expect(issue.rule_code).toBe('type-union-without-alias');
    expect(issue.severity).toBe('warning');
    expect(issue.message).toContain('Property');
    expect(issue.message).toContain('value');
    expect(issue.message).toContain("interface 'Full'");
    expect(issue.message).toContain('3 members');
    expect(issue.suggestion).toBe("Extract to type alias 'FullValue'");
    expect(issue.package_id).toBe(PACKAGE_ID);
    expect(issue.module_id).toBe(MODULE_ID);
    expect(issue.file_path).toBe(FILE_PATH);
    expect(issue.entity_type).toBe('property');
    expect(issue.entity_name).toBe('value');
    expect(issue.parent_entity_id).toBe(ifaceDTO.id);
    expect(issue.parent_entity_type).toBe('interface');
    expect(issue.parent_entity_name).toBe('Full');
    expect(issue.property_name).toBe('value');
    expect(issue.refactor_action).toBe('extract-type-union');
  });

  it('generates deterministic issue IDs for the same input', () => {
    const source = `
interface Stable {
  kind: "a" | "b" | "c";
}`;
    const ifaceDTO = makeInterfaceDTO('Stable');
    const ctx1 = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const ctx2 = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues1 = typeUnionWithoutAlias.check(ctx1);
    const issues2 = typeUnionWithoutAlias.check(ctx2);
    expect(issues1[0].id).toBe(issues2[0].id);
  });

  it('generates different issue IDs for different properties', () => {
    const source = `
interface TwoProps {
  alpha: "x" | "y" | "z";
  beta: "a" | "b" | "c";
}`;
    const ifaceDTO = makeInterfaceDTO('TwoProps');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(2);
    expect(issues[0].id).not.toBe(issues[1].id);
  });
});

// ---------------------------------------------------------------------------
// Non-identifier keys and edge cases
// ---------------------------------------------------------------------------

describe('typeUnionWithoutAlias.check edge cases', () => {
  it('skips interface properties with non-Identifier keys (computed)', () => {
    const source = `
interface Computed {
  ["computed"]: "a" | "b" | "c";
  normal: "x" | "y" | "z";
}`;
    const ifaceDTO = makeInterfaceDTO('Computed');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    // Only "normal" should be detected; computed key is a StringLiteral
    expect(issues).toHaveLength(1);
    expect(issues[0].entity_name).toBe('normal');
  });

  it('handles interface with no body members', () => {
    const source = `interface Empty {}`;
    const ifaceDTO = makeInterfaceDTO('Empty');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });

  it('handles class with no body members', () => {
    const source = `class Empty {}`;
    const classDTO = makeClassDTO('Empty');
    const context = makeContext(source, {
      parseResult: { classes: [classDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });

  it('handles property with no type annotation', () => {
    // Class property without explicit type annotation
    const source = `
class NoType {
  value = "hello";
}`;
    const classDTO = makeClassDTO('NoType');
    const context = makeContext(source, {
      parseResult: { classes: [classDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });

  it('handles non-union type annotations (e.g., intersection)', () => {
    const source = `
interface Intersected {
  value: { a: string } & { b: number };
}`;
    const ifaceDTO = makeInterfaceDTO('Intersected');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });

  it('handles union of complex types (not just string literals)', () => {
    const source = `
interface Complex {
  handler: (() => void) | ((x: number) => string) | null;
}`;
    const ifaceDTO = makeInterfaceDTO('Complex');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].entity_name).toBe('handler');
    const refCtx = issues[0].refactor_context as Record<string, unknown>;
    expect(refCtx.unionMembers).toHaveLength(3);
  });

  it('handles class with anonymous class expression (no id)', () => {
    // jscodeshift ClassDeclaration requires an id, but default export can omit
    const source = `
export default class {
  value: "a" | "b" | "c";
}`;
    // No class DTO with a matching name, so it should bail
    const context = makeContext(source);
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toEqual([]);
  });

  it('handles interface whose DTO has a different module_id', () => {
    const source = `
interface WrongModule {
  val: "a" | "b" | "c";
}`;
    // DTO with a different module_id
    const ifaceDTO: IInterfaceCreateDTO = {
      id: 'iface-wrong',
      package_id: PACKAGE_ID,
      module_id: 'some-other-module',
      name: 'WrongModule',
    };
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    // The findInterfaceDTO filters by moduleId, so this should not match
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PascalCase conversion (toPascalCase via suggestion)
// ---------------------------------------------------------------------------

describe('typeUnionWithoutAlias.check PascalCase suggestion naming', () => {
  it('converts snake_case property name to PascalCase', () => {
    const source = `
interface Snake {
  my_prop_name: "a" | "b" | "c";
}`;
    const ifaceDTO = makeInterfaceDTO('Snake');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).toBe("Extract to type alias 'SnakeMyPropName'");
  });

  it('converts kebab-like property name to PascalCase', () => {
    // While unusual in TS, we test the toPascalCase behavior
    const source = `
interface Kebab {
  "my-value": "a" | "b" | "c";
}`;
    const ifaceDTO = makeInterfaceDTO('Kebab');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    // String literal key is not an Identifier, so it should be skipped
    expect(issues).toEqual([]);
  });

  it('preserves already-PascalCase property name', () => {
    const source = `
interface Already {
  MyValue: "a" | "b" | "c";
}`;
    const ifaceDTO = makeInterfaceDTO('Already');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).toBe("Extract to type alias 'AlreadyMyValue'");
  });

  it('handles camelCase property name', () => {
    const source = `
interface Camel {
  myValue: "a" | "b" | "c";
}`;
    const ifaceDTO = makeInterfaceDTO('Camel');
    const context = makeContext(source, {
      parseResult: { interfaces: [ifaceDTO] },
    });
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).toBe("Extract to type alias 'CamelMyValue'");
  });
});
