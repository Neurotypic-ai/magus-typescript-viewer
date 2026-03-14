import jscodeshift from 'jscodeshift';

import { extractTypeUnion } from '../extractTypeUnion';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const j = jscodeshift.withParser('tsx');

/** Run the transform on raw source code and return the resulting source. */
function run(source: string, context: Record<string, unknown>): string {
  const root = j(source);
  return extractTypeUnion.execute(j, root, source, context);
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------
describe('extractTypeUnion metadata', () => {
  it('has the correct action identifier', () => {
    expect(extractTypeUnion.action).toBe('extract-type-union');
  });

  it('has a human-readable name', () => {
    expect(extractTypeUnion.name).toBe('Extract Type Union');
  });

  it('has a description', () => {
    expect(typeof extractTypeUnion.description).toBe('string');
    expect(extractTypeUnion.description.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Context validation
// ---------------------------------------------------------------------------
describe('extractTypeUnion context validation', () => {
  const source = 'interface Foo { bar: string | number; }';

  it('throws when context is empty', () => {
    expect(() => run(source, {})).toThrow('Invalid context');
  });

  it('throws when suggestedName is missing', () => {
    expect(() =>
      run(source, {
        parentName: 'Foo',
        parentType: 'interface',
        propertyName: 'bar',
      }),
    ).toThrow('Invalid context');
  });

  it('throws when parentName is missing', () => {
    expect(() =>
      run(source, {
        suggestedName: 'BarType',
        parentType: 'interface',
        propertyName: 'bar',
      }),
    ).toThrow('Invalid context');
  });

  it('throws when parentType is missing', () => {
    expect(() =>
      run(source, {
        suggestedName: 'BarType',
        parentName: 'Foo',
        propertyName: 'bar',
      }),
    ).toThrow('Invalid context');
  });

  it('throws when propertyName is missing', () => {
    expect(() =>
      run(source, {
        suggestedName: 'BarType',
        parentName: 'Foo',
        parentType: 'interface',
      }),
    ).toThrow('Invalid context');
  });
});

// ---------------------------------------------------------------------------
// Interface property extraction
// ---------------------------------------------------------------------------
describe('extractTypeUnion on interfaces', () => {
  it('extracts a union type from an interface property', () => {
    const source = `interface Config {
  mode: "development" | "production" | "test";
  port: number;
}`;

    const result = run(source, {
      suggestedName: 'Mode',
      parentName: 'Config',
      parentType: 'interface',
      propertyName: 'mode',
    });

    // The new type alias should appear before the interface
    expect(result).toContain('type Mode');
    // The property should now reference the new type
    expect(result).toContain('mode: Mode');
    // The union literals should be in the type alias, not in the interface property
    expect(result).toContain('"development"');
    expect(result).toContain('"production"');
    expect(result).toContain('"test"');
    // The port property should be untouched
    expect(result).toContain('port: number');
  });

  it('extracts a union of primitive types', () => {
    const source = `interface Value {
  data: string | number | boolean;
}`;

    const result = run(source, {
      suggestedName: 'DataType',
      parentName: 'Value',
      parentType: 'interface',
      propertyName: 'data',
    });

    expect(result).toContain('type DataType');
    expect(result).toContain('data: DataType');
  });

  it('throws when the interface is not found', () => {
    const source = `interface Other { x: number; }`;

    expect(() =>
      run(source, {
        suggestedName: 'XType',
        parentName: 'Missing',
        parentType: 'interface',
        propertyName: 'x',
      }),
    ).toThrow("Interface 'Missing' not found");
  });

  it('throws when the property is not found on the interface', () => {
    const source = `interface Config { mode: string | number; }`;

    expect(() =>
      run(source, {
        suggestedName: 'XType',
        parentName: 'Config',
        parentType: 'interface',
        propertyName: 'nonexistent',
      }),
    ).toThrow("Property 'nonexistent' not found on interface 'Config'");
  });

  it('throws when the property does not have a union type', () => {
    const source = `interface Config { mode: string; }`;

    expect(() =>
      run(source, {
        suggestedName: 'ModeType',
        parentName: 'Config',
        parentType: 'interface',
        propertyName: 'mode',
      }),
    ).toThrow("does not have a union type annotation");
  });

  it('handles an exported interface and adds export to the type alias', () => {
    const source = `export interface Settings {
  theme: "light" | "dark";
}`;

    const result = run(source, {
      suggestedName: 'Theme',
      parentName: 'Settings',
      parentType: 'interface',
      propertyName: 'theme',
    });

    // The type alias should also be exported
    expect(result).toContain('export type Theme');
    // The property should reference the new type
    expect(result).toContain('theme: Theme');
  });

  it('does not export the type alias for a non-exported interface', () => {
    const source = `interface Internal {
  status: "active" | "inactive";
}`;

    const result = run(source, {
      suggestedName: 'Status',
      parentName: 'Internal',
      parentType: 'interface',
      propertyName: 'status',
    });

    expect(result).toContain('type Status');
    // Should NOT contain "export type Status"
    const lines = result.split('\n');
    const typeAliasLine = lines.find((l) => l.includes('type Status'));
    expect(typeAliasLine).toBeDefined();
    expect(typeAliasLine).not.toMatch(/^export\s/);
  });

  it('preserves other properties on the interface', () => {
    const source = `interface Config {
  name: string;
  level: "info" | "warn" | "error";
  count: number;
}`;

    const result = run(source, {
      suggestedName: 'LogLevel',
      parentName: 'Config',
      parentType: 'interface',
      propertyName: 'level',
    });

    expect(result).toContain('name: string');
    expect(result).toContain('level: LogLevel');
    expect(result).toContain('count: number');
  });

  it('throws when multiple interfaces share the same name', () => {
    const source = `interface Foo { bar: string | number; }\ninterface Foo { baz: boolean | string; }`;
    expect(() =>
      run(source, {
        suggestedName: 'BarType',
        parentName: 'Foo',
        parentType: 'interface',
        propertyName: 'bar',
      }),
    ).toThrow('Multiple declarations');
  });

  it('handles export default interface without exporting the type alias', () => {
    const source = `export default interface Settings { theme: "light" | "dark"; }`;
    const result = run(source, {
      suggestedName: 'Theme',
      parentName: 'Settings',
      parentType: 'interface',
      propertyName: 'theme',
    });
    expect(result).toContain('type Theme');
    expect(result).toContain('theme: Theme');
    // The type alias should NOT be default-exported
    expect(result).not.toContain('export type Theme');
    expect(result).not.toContain('export default type');
  });

  it('handles multiline union types', () => {
    const source = `interface Config {
  level:
    | "debug"
    | "info"
    | "warn"
    | "error";
}`;
    const result = run(source, {
      suggestedName: 'LogLevel',
      parentName: 'Config',
      parentType: 'interface',
      propertyName: 'level',
    });
    expect(result).toContain('type LogLevel');
    expect(result).toContain('level: LogLevel');
  });
});

// ---------------------------------------------------------------------------
// Class property extraction
// ---------------------------------------------------------------------------
describe('extractTypeUnion on classes', () => {
  it('extracts a union type from a class property', () => {
    const source = `class Widget {
  variant: "primary" | "secondary" | "danger";
  label: string;
}`;

    const result = run(source, {
      suggestedName: 'Variant',
      parentName: 'Widget',
      parentType: 'class',
      propertyName: 'variant',
    });

    expect(result).toContain('type Variant');
    expect(result).toContain('variant: Variant');
    expect(result).toContain('label: string');
  });

  it('throws when the class is not found', () => {
    const source = `class Widget { x: string | number; }`;

    expect(() =>
      run(source, {
        suggestedName: 'XType',
        parentName: 'Missing',
        parentType: 'class',
        propertyName: 'x',
      }),
    ).toThrow("Class 'Missing' not found");
  });

  it('throws when the property is not found on the class', () => {
    const source = `class Widget { variant: "a" | "b"; }`;

    expect(() =>
      run(source, {
        suggestedName: 'XType',
        parentName: 'Widget',
        parentType: 'class',
        propertyName: 'nonexistent',
      }),
    ).toThrow("Property 'nonexistent' not found on class 'Widget'");
  });

  it('throws when the class property does not have a union type', () => {
    const source = `class Widget { variant: string; }`;

    expect(() =>
      run(source, {
        suggestedName: 'VariantType',
        parentName: 'Widget',
        parentType: 'class',
        propertyName: 'variant',
      }),
    ).toThrow("does not have a union type annotation");
  });

  it('handles an exported class and adds export to the type alias', () => {
    const source = `export class AppState {
  phase: "loading" | "ready" | "error";
}`;

    const result = run(source, {
      suggestedName: 'Phase',
      parentName: 'AppState',
      parentType: 'class',
      propertyName: 'phase',
    });

    expect(result).toContain('export type Phase');
    expect(result).toContain('phase: Phase');
  });

  it('does not export the type alias for a non-exported class', () => {
    const source = `class InternalState {
  phase: "loading" | "ready";
}`;

    const result = run(source, {
      suggestedName: 'Phase',
      parentName: 'InternalState',
      parentType: 'class',
      propertyName: 'phase',
    });

    expect(result).toContain('type Phase');
    const lines = result.split('\n');
    const typeAliasLine = lines.find((l) => l.includes('type Phase'));
    expect(typeAliasLine).toBeDefined();
    expect(typeAliasLine).not.toMatch(/^export\s/);
  });

  it('throws when multiple classes share the same name (parser rejects duplicate identifiers)', () => {
    // Unlike interfaces, duplicate class names are a parse error in JS/TS,
    // so the jscodeshift parser itself rejects this before our transform runs.
    const source = `class Foo { bar: string | number; }\nclass Foo { baz: boolean | string; }`;
    expect(() =>
      run(source, {
        suggestedName: 'BarType',
        parentName: 'Foo',
        parentType: 'class',
        propertyName: 'bar',
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Name conflict detection
// ---------------------------------------------------------------------------
describe('extractTypeUnion name conflict detection', () => {
  it('throws when suggested name conflicts with existing type alias', () => {
    const source = `type Mode = "a";\ninterface Config { mode: "dev" | "prod"; }`;
    expect(() =>
      run(source, {
        suggestedName: 'Mode',
        parentName: 'Config',
        parentType: 'interface',
        propertyName: 'mode',
      }),
    ).toThrow('already exists');
  });

  it('throws when suggested name conflicts with existing type alias for class', () => {
    const source = `type Variant = "x";\nclass Widget { variant: "a" | "b"; }`;
    expect(() =>
      run(source, {
        suggestedName: 'Variant',
        parentName: 'Widget',
        parentType: 'class',
        propertyName: 'variant',
      }),
    ).toThrow('already exists');
  });

  it('throws when suggested name conflicts with an imported symbol', () => {
    const source = `import { Mode } from './types';\ninterface Config { mode: "dev" | "prod"; }`;
    expect(() =>
      run(source, {
        suggestedName: 'Mode',
        parentName: 'Config',
        parentType: 'interface',
        propertyName: 'mode',
      }),
    ).toThrow('already exists');
  });

  it('throws when suggested name conflicts with an existing class name', () => {
    const source = `class Status {}\ninterface Config { status: "active" | "inactive"; }`;
    expect(() =>
      run(source, {
        suggestedName: 'Status',
        parentName: 'Config',
        parentType: 'interface',
        propertyName: 'status',
      }),
    ).toThrow('already exists');
  });
});

// ---------------------------------------------------------------------------
// Output validity
// ---------------------------------------------------------------------------
describe('extractTypeUnion output validity', () => {
  it('produces parseable TypeScript for interface extraction', () => {
    const source = `interface Options {
  format: "json" | "csv" | "xml";
}`;

    const result = run(source, {
      suggestedName: 'OutputFormat',
      parentName: 'Options',
      parentType: 'interface',
      propertyName: 'format',
    });

    // Should not throw when re-parsed
    expect(() => j(result)).not.toThrow();
  });

  it('produces parseable TypeScript for class extraction', () => {
    const source = `class Logger {
  level: "debug" | "info" | "warn" | "error";
}`;

    const result = run(source, {
      suggestedName: 'LogLevel',
      parentName: 'Logger',
      parentType: 'class',
      propertyName: 'level',
    });

    expect(() => j(result)).not.toThrow();
  });

  it('inserts the type alias before the interface declaration', () => {
    const source = `interface Foo {
  bar: "a" | "b";
}`;

    const result = run(source, {
      suggestedName: 'BarType',
      parentName: 'Foo',
      parentType: 'interface',
      propertyName: 'bar',
    });

    const typeAliasIndex = result.indexOf('type BarType');
    const interfaceIndex = result.indexOf('interface Foo');
    expect(typeAliasIndex).toBeGreaterThanOrEqual(0);
    expect(interfaceIndex).toBeGreaterThan(typeAliasIndex);
  });

  it('inserts the type alias before the class declaration', () => {
    const source = `class Foo {
  bar: "a" | "b";
}`;

    const result = run(source, {
      suggestedName: 'BarType',
      parentName: 'Foo',
      parentType: 'class',
      propertyName: 'bar',
    });

    const typeAliasIndex = result.indexOf('type BarType');
    const classIndex = result.indexOf('class Foo');
    expect(typeAliasIndex).toBeGreaterThanOrEqual(0);
    expect(classIndex).toBeGreaterThan(typeAliasIndex);
  });
});

// ---------------------------------------------------------------------------
// Access modifiers preserved after extraction
// ---------------------------------------------------------------------------

describe('extractTypeUnion — access modifiers preserved', () => {
  it('preserves readonly modifier on interface property after extraction', () => {
    // readonly is a node property on TSPropertySignature; transform only mutates typeAnnotation
    const source = `interface Config {
  readonly mode: "dev" | "staging" | "prod";
}`;

    const result = run(source, {
      suggestedName: 'ConfigMode',
      parentName: 'Config',
      parentType: 'interface',
      propertyName: 'mode',
    });

    // Type alias is created with the union members
    expect(result).toContain('type ConfigMode');
    // Property now uses the alias — and keeps its readonly modifier
    expect(result).toContain('readonly mode: ConfigMode');
  });

  it('preserves optional flag on interface property (?:) after extraction', () => {
    const source = `interface Options {
  format?: "json" | "xml" | "csv";
}`;

    const result = run(source, {
      suggestedName: 'OptionsFormat',
      parentName: 'Options',
      parentType: 'interface',
      propertyName: 'format',
    });

    // Optional marker should survive — the property key retains its ? sigil
    expect(result).toContain('format?: OptionsFormat');
  });

  it('preserves protected accessibility on class property after extraction', () => {
    const source = `class Base {
  protected phase: "init" | "running" | "done";
}`;

    const result = run(source, {
      suggestedName: 'BasePhase',
      parentName: 'Base',
      parentType: 'class',
      propertyName: 'phase',
    });

    // protected keyword and the alias reference must both appear on the property
    expect(result).toContain('protected phase: BasePhase');
    // Type alias is created separately
    expect(result).toContain('type BasePhase');
  });

  it('preserves readonly modifier on class property after extraction', () => {
    const source = `class Theme {
  readonly variant: "primary" | "secondary" | "danger";
}`;

    const result = run(source, {
      suggestedName: 'ThemeVariant',
      parentName: 'Theme',
      parentType: 'class',
      propertyName: 'variant',
    });

    expect(result).toContain('readonly variant: ThemeVariant');
    expect(result).toContain('type ThemeVariant');
  });
});

// ---------------------------------------------------------------------------
// Sequential transforms on same file
// ---------------------------------------------------------------------------

describe('extractTypeUnion — sequential transforms on same file', () => {
  it('extracts two unions from same interface in sequence', () => {
    const source = `interface ApiConfig {
  method: "GET" | "POST" | "PUT";
  format: "json" | "xml" | "csv";
}`;

    // First transform: extract method union
    const intermediate = run(source, {
      suggestedName: 'ApiConfigMethod',
      parentName: 'ApiConfig',
      parentType: 'interface',
      propertyName: 'method',
    });

    // Second transform on the intermediate result: extract format union
    const final = run(intermediate, {
      suggestedName: 'ApiConfigFormat',
      parentName: 'ApiConfig',
      parentType: 'interface',
      propertyName: 'format',
    });

    expect(final).toContain('type ApiConfigMethod');
    expect(final).toContain('type ApiConfigFormat');
    // Both properties now reference their aliases, not inline unions
    expect(final).toContain('method: ApiConfigMethod');
    expect(final).toContain('format: ApiConfigFormat');
    // Verify the result is still parseable TypeScript
    expect(() => j(final)).not.toThrow();
  });

  it('second extract on the same property fails (property now references alias, not union)', () => {
    const source = `interface Widget {
  size: "sm" | "md" | "lg";
}`;

    const intermediate = run(source, {
      suggestedName: 'WidgetSize',
      parentName: 'Widget',
      parentType: 'interface',
      propertyName: 'size',
    });

    // Running again on the same property should throw because the type annotation
    // is now TSTypeReference (WidgetSize), not TSUnionType
    expect(() =>
      run(intermediate, {
        suggestedName: 'WidgetSizeAgain',
        parentName: 'Widget',
        parentType: 'interface',
        propertyName: 'size',
      }),
    ).toThrow("does not have a union type annotation");
  });
});

// ---------------------------------------------------------------------------
// Name conflict with non-TypeAlias declarations
// ---------------------------------------------------------------------------

describe('extractTypeUnion — name conflict with existing declarations', () => {
  it('throws when suggested name conflicts with an existing interface name', () => {
    // checkNameConflict checks TSInterfaceDeclaration in addition to TSTypeAliasDeclaration
    const source = `interface WidgetSize {
  label: string;
}
interface Widget {
  size: "sm" | "md" | "lg";
}`;

    expect(() =>
      run(source, {
        suggestedName: 'WidgetSize',  // already an interface name
        parentName: 'Widget',
        parentType: 'interface',
        propertyName: 'size',
      }),
    ).toThrow("already exists in this file scope");
  });

  it('throws when suggested name conflicts with an existing class name', () => {
    const source = `class LogLevel {}
class Logger {
  level: "debug" | "info" | "error";
}`;

    expect(() =>
      run(source, {
        suggestedName: 'LogLevel',
        parentName: 'Logger',
        parentType: 'class',
        propertyName: 'level',
      }),
    ).toThrow("already exists in this file scope");
  });

  it('throws when suggested name conflicts with an existing type alias', () => {
    const source = `type WidgetSize = string;
interface Widget {
  size: "sm" | "md" | "lg";
}`;

    expect(() =>
      run(source, {
        suggestedName: 'WidgetSize',
        parentName: 'Widget',
        parentType: 'interface',
        propertyName: 'size',
      }),
    ).toThrow("already exists in this file scope");
  });
});
