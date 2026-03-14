// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { detectTechDebt } from '../detectTechDebt';

describe('detectTechDebt', () => {
  describe('ts-ignore detection', () => {
    it('detects @ts-ignore comments', () => {
      const source = `
// @ts-ignore
const x = badCode();
`;
      const report = detectTechDebt(source);
      expect(report.markers).toHaveLength(1);
      expect(report.markers[0].type).toBe('ts_ignore');
      expect(report.markers[0].severity).toBe('error');
      expect(report.markers[0].line).toBe(2);
    });

    it('detects @ts-ignore with extra spacing', () => {
      const source = `//  @ts-ignore`;
      const report = detectTechDebt(source);
      expect(report.markers).toHaveLength(1);
      expect(report.markers[0].type).toBe('ts_ignore');
    });
  });

  describe('ts-expect-error detection', () => {
    it('detects @ts-expect-error comments', () => {
      const source = `
// @ts-expect-error some reason
const y = brokenCode();
`;
      const report = detectTechDebt(source);
      expect(report.markers).toHaveLength(1);
      expect(report.markers[0].type).toBe('ts_expect_error');
      expect(report.markers[0].severity).toBe('warning');
      expect(report.markers[0].line).toBe(2);
    });
  });

  describe('TODO/FIXME/HACK comment detection', () => {
    it('detects TODO comments (case insensitive)', () => {
      const source = `
// TODO: fix this later
// todo something
`;
      const report = detectTechDebt(source);
      expect(report.markers).toHaveLength(2);
      expect(report.markers[0].type).toBe('todo_comment');
      expect(report.markers[0].severity).toBe('info');
      expect(report.markers[1].type).toBe('todo_comment');
    });

    it('detects FIXME comments', () => {
      const source = `// FIXME: broken logic`;
      const report = detectTechDebt(source);
      expect(report.markers).toHaveLength(1);
      expect(report.markers[0].type).toBe('fixme_comment');
      expect(report.markers[0].severity).toBe('warning');
    });

    it('detects HACK comments', () => {
      const source = `// HACK: workaround for bug`;
      const report = detectTechDebt(source);
      expect(report.markers).toHaveLength(1);
      expect(report.markers[0].type).toBe('hack_comment');
      expect(report.markers[0].severity).toBe('warning');
    });

    it('detects TODO in block comments', () => {
      const source = `/* TODO: refactor this */`;
      const report = detectTechDebt(source);
      expect(report.markers).toHaveLength(1);
      expect(report.markers[0].type).toBe('todo_comment');
    });
  });

  describe('any type annotation detection', () => {
    it('detects : any type annotations', () => {
      const source = `const x: any = 42;`;
      const report = detectTechDebt(source);
      expect(report.markers.some((m) => m.type === 'any_type')).toBe(true);
      expect(report.markers.find((m) => m.type === 'any_type')?.severity).toBe('error');
    });

    it('detects : any in function parameters', () => {
      const source = `function foo(bar: any): void {}`;
      const report = detectTechDebt(source);
      expect(report.markers.some((m) => m.type === 'any_type')).toBe(true);
    });

    it('does not false-positive on "anything" or "any" in variable names', () => {
      const source = `const anything = 42;`;
      const report = detectTechDebt(source);
      expect(report.markers.filter((m) => m.type === 'any_type')).toHaveLength(0);
    });
  });

  describe('type assertion detection', () => {
    it('detects as any assertions', () => {
      const source = `const x = value as any;`;
      const report = detectTechDebt(source);
      expect(report.markers.some((m) => m.type === 'type_assertion')).toBe(true);
    });

    it('detects as unknown as double assertions', () => {
      const source = `const x = value as unknown as string;`;
      const report = detectTechDebt(source);
      expect(report.markers.some((m) => m.type === 'type_assertion')).toBe(true);
    });
  });

  describe('non-null assertion detection', () => {
    it('detects variable!. non-null assertions', () => {
      const source = `const x = obj!.property;`;
      const report = detectTechDebt(source);
      expect(report.markers.some((m) => m.type === 'non_null_assertion')).toBe(true);
      expect(report.markers.find((m) => m.type === 'non_null_assertion')?.severity).toBe('warning');
    });

    it('detects variable!, non-null assertions', () => {
      const source = `callFn(value!, other);`;
      const report = detectTechDebt(source);
      expect(report.markers.some((m) => m.type === 'non_null_assertion')).toBe(true);
    });

    it('detects variable!) non-null assertions', () => {
      const source = `callFn(value!)`;
      const report = detectTechDebt(source);
      expect(report.markers.some((m) => m.type === 'non_null_assertion')).toBe(true);
    });
  });

  describe('non-null assertion with !== on same line', () => {
    it('detects non-null assertion even when line also contains !==', () => {
      const source = `if (obj!.value !== undefined) {}`;
      const report = detectTechDebt(source);
      expect(report.markers.some((m) => m.type === 'non_null_assertion')).toBe(true);
    });
  });

  describe('patterns inside string literals', () => {
    it('does not detect ": any" inside a string literal', () => {
      const source = `const msg = "type: any is bad";`;
      const report = detectTechDebt(source);
      expect(report.markers.filter((m) => m.type === 'any_type')).toHaveLength(0);
    });

    it('does not detect // TODO inside a string literal', () => {
      const source = `const msg = "// TODO: fix this";`;
      const report = detectTechDebt(source);
      expect(report.markers.filter((m) => m.type === 'todo_comment')).toHaveLength(0);
    });
  });

  describe('CRLF line endings', () => {
    it('handles Windows CRLF line endings correctly', () => {
      const source = "// TODO: first\r\n// FIXME: second\r\nconst x: any = 1;\r\n";
      const report = detectTechDebt(source);
      expect(report.markers).toHaveLength(3);
      expect(report.markers[0].type).toBe('todo_comment');
      expect(report.markers[0].line).toBe(1);
      expect(report.markers[1].type).toBe('fixme_comment');
      expect(report.markers[1].line).toBe(2);
      expect(report.markers[2].type).toBe('any_type');
      expect(report.markers[2].line).toBe(3);
    });
  });

  describe('scoring', () => {
    it('returns score of 100 for clean code', () => {
      const source = `
const x: string = "hello";
function add(a: number, b: number): number {
  return a + b;
}
`;
      const report = detectTechDebt(source);
      expect(report.score).toBe(100);
      expect(report.markers).toHaveLength(0);
    });

    it('deducts 5 points per marker', () => {
      const source = `
// TODO: fix
// FIXME: broken
`;
      const report = detectTechDebt(source);
      expect(report.markers).toHaveLength(2);
      expect(report.score).toBe(90);
    });

    it('does not go below 0', () => {
      const lines: string[] = [];
      for (let i = 0; i < 25; i++) {
        lines.push(`// TODO: item ${i}`);
      }
      const report = detectTechDebt(lines.join('\n'));
      expect(report.score).toBe(0);
    });
  });

  describe('counts', () => {
    it('groups markers by type in counts', () => {
      const source = `
// TODO: first
// TODO: second
// FIXME: third
const x: any = 1;
`;
      const report = detectTechDebt(source);
      expect(report.counts['todo_comment']).toBe(2);
      expect(report.counts['fixme_comment']).toBe(1);
      expect(report.counts['any_type']).toBe(1);
    });
  });

  describe('snippet truncation', () => {
    it('truncates long lines in snippets', () => {
      const longLine = `// TODO: ${'x'.repeat(200)}`;
      const report = detectTechDebt(longLine);
      expect(report.markers[0].snippet.length).toBeLessThanOrEqual(80);
      expect(report.markers[0].snippet).toContain('...');
    });
  });

  describe('mixed source', () => {
    it('detects multiple marker types in realistic code', () => {
      const source = `
import { Service } from './service';

// @ts-ignore
const config: any = loadConfig();

// TODO: replace with proper typing
function process(data: any): any {
  // HACK: workaround for upstream bug
  const result = data as unknown as string;
  return result!.trim();
}
`;
      const report = detectTechDebt(source);

      // Should detect: ts_ignore, any_type (x3), todo, hack, type_assertion, non_null_assertion
      expect(report.markers.length).toBeGreaterThanOrEqual(7);
      expect(report.counts['ts_ignore']).toBe(1);
      expect(report.counts['any_type']).toBeGreaterThanOrEqual(2);
      expect(report.counts['todo_comment']).toBe(1);
      expect(report.counts['hack_comment']).toBe(1);
      expect(report.counts['type_assertion']).toBeGreaterThanOrEqual(1);
    });
  });
});
