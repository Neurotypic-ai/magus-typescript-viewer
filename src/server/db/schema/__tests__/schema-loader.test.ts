// @vitest-environment node

import { loadSchema } from '../schema-loader';

describe('loadSchema', () => {
  it('returns the contents of schema.sql as a string', () => {
    const result = loadSchema();

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('contains expected SQL CREATE TABLE statements', () => {
    const result = loadSchema();

    expect(result).toContain('CREATE TABLE packages');
    expect(result).toContain('CREATE TABLE modules');
    expect(result).toContain('CREATE TABLE classes');
    expect(result).toContain('CREATE TABLE interfaces');
    expect(result).toContain('CREATE TABLE methods');
    expect(result).toContain('CREATE TABLE properties');
    expect(result).toContain('CREATE TABLE imports');
    expect(result).toContain('CREATE TABLE exports');
  });

  it('contains junction table definitions', () => {
    const result = loadSchema();

    expect(result).toContain('CREATE TABLE class_implements');
    expect(result).toContain('CREATE TABLE interface_extends');
    expect(result).toContain('CREATE TABLE class_extends');
  });

  it('contains CREATE INDEX statements', () => {
    const result = loadSchema();

    expect(result).toContain('CREATE INDEX');
    expect(result).toContain('idx_modules_package_id');
    expect(result).toContain('idx_classes_module_id');
  });

  it('contains SQL comment lines starting with --', () => {
    const result = loadSchema();

    const lines = result.split('\n');
    const commentLines = lines.filter((line) => line.trim().startsWith('--'));
    expect(commentLines.length).toBeGreaterThan(0);
  });

  it('contains semicolons to delimit SQL statements', () => {
    const result = loadSchema();

    const semicolonCount = (result.match(/;/g) ?? []).length;
    // The schema has many CREATE TABLE + CREATE INDEX statements
    expect(semicolonCount).toBeGreaterThan(10);
  });

  it('returns consistent results on repeated calls', () => {
    const first = loadSchema();
    const second = loadSchema();

    expect(first).toBe(second);
  });

  describe('schema content structure', () => {
    it('can be split into non-empty SQL statements after removing comments', () => {
      const schema = loadSchema();

      const uncommented = schema
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');

      const statements = uncommented
        .split(';')
        .map((stmt) => stmt.trim())
        .filter((stmt) => stmt.length > 0);

      expect(statements.length).toBeGreaterThan(0);

      // Every statement should be meaningful SQL (CREATE TABLE or CREATE INDEX)
      for (const stmt of statements) {
        const upper = stmt.toUpperCase();
        expect(upper.startsWith('CREATE TABLE') || upper.startsWith('CREATE INDEX')).toBe(true);
      }
    });

    it('does not contain any empty statements between semicolons', () => {
      const schema = loadSchema();

      // Check for double semicolons or semicolons with only whitespace between them
      const hasEmptyStatements = /;\s*;/.test(schema);
      expect(hasEmptyStatements).toBe(false);
    });

    it('contains all tables needed by downstream Database.executeSchema', () => {
      const schema = loadSchema();

      const requiredTables = [
        'packages',
        'dependencies',
        'modules',
        'module_tests',
        'classes',
        'interfaces',
        'methods',
        'parameters',
        'properties',
        'imports',
        'exports',
        'functions',
        'symbol_references',
        'type_aliases',
        'enums',
        'variables',
        'code_issues',
      ];

      for (const table of requiredTables) {
        expect(schema).toContain(`CREATE TABLE ${table}`);
      }
    });

    it('ends with a trailing newline', () => {
      const schema = loadSchema();

      expect(schema.endsWith('\n')).toBe(true);
    });
  });
});
