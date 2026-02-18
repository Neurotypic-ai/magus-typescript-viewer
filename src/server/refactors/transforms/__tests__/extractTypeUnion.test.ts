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
        unionMembers: ['string', 'number'],
      }),
    ).toThrow('Invalid context');
  });

  it('throws when parentName is missing', () => {
    expect(() =>
      run(source, {
        suggestedName: 'BarType',
        parentType: 'interface',
        propertyName: 'bar',
        unionMembers: ['string', 'number'],
      }),
    ).toThrow('Invalid context');
  });

  it('throws when parentType is missing', () => {
    expect(() =>
      run(source, {
        suggestedName: 'BarType',
        parentName: 'Foo',
        propertyName: 'bar',
        unionMembers: ['string', 'number'],
      }),
    ).toThrow('Invalid context');
  });

  it('throws when propertyName is missing', () => {
    expect(() =>
      run(source, {
        suggestedName: 'BarType',
        parentName: 'Foo',
        parentType: 'interface',
        unionMembers: ['string', 'number'],
      }),
    ).toThrow('Invalid context');
  });

  it('throws when unionMembers is missing', () => {
    expect(() =>
      run(source, {
        suggestedName: 'BarType',
        parentName: 'Foo',
        parentType: 'interface',
        propertyName: 'bar',
      }),
    ).toThrow('Invalid context');
  });

  it('throws when unionMembers is not an array', () => {
    expect(() =>
      run(source, {
        suggestedName: 'BarType',
        parentName: 'Foo',
        parentType: 'interface',
        propertyName: 'bar',
        unionMembers: 'string | number',
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
      unionMembers: ['development', 'production', 'test'],
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
      unionMembers: ['string', 'number', 'boolean'],
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
        unionMembers: ['number'],
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
        unionMembers: ['string', 'number'],
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
        unionMembers: ['string'],
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
      unionMembers: ['light', 'dark'],
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
      unionMembers: ['active', 'inactive'],
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
      unionMembers: ['info', 'warn', 'error'],
    });

    expect(result).toContain('name: string');
    expect(result).toContain('level: LogLevel');
    expect(result).toContain('count: number');
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
      unionMembers: ['primary', 'secondary', 'danger'],
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
        unionMembers: ['string', 'number'],
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
        unionMembers: ['a', 'b'],
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
        unionMembers: ['string'],
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
      unionMembers: ['loading', 'ready', 'error'],
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
      unionMembers: ['loading', 'ready'],
    });

    expect(result).toContain('type Phase');
    const lines = result.split('\n');
    const typeAliasLine = lines.find((l) => l.includes('type Phase'));
    expect(typeAliasLine).toBeDefined();
    expect(typeAliasLine).not.toMatch(/^export\s/);
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
      unionMembers: ['json', 'csv', 'xml'],
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
      unionMembers: ['debug', 'info', 'warn', 'error'],
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
      unionMembers: ['a', 'b'],
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
      unionMembers: ['a', 'b'],
    });

    const typeAliasIndex = result.indexOf('type BarType');
    const classIndex = result.indexOf('class Foo');
    expect(typeAliasIndex).toBeGreaterThanOrEqual(0);
    expect(classIndex).toBeGreaterThan(typeAliasIndex);
  });
});
