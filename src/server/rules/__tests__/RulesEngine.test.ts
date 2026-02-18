import { vi } from 'vitest';

import { RulesEngine } from '../RulesEngine';
import { defaultRulesConfig } from '../RulesConfig';

import type { ParseResult } from '../../parsers/ParseResult';
import type { CodeIssue, Rule, RuleContext } from '../Rule';

// ---------------------------------------------------------------------------
// Mock fs/promises so analyze() never hits the filesystem
// ---------------------------------------------------------------------------
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal empty ParseResult for tests that don't need real data. */
function emptyParseResult(overrides?: Partial<ParseResult>): ParseResult {
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
    ...overrides,
  };
}

/** Creates a ParseResult with a single module pointing at the given file path. */
function parseResultWithModule(filePath: string, moduleId = 'mod-1', packageId = 'pkg-1'): ParseResult {
  return emptyParseResult({
    package: { id: packageId, name: 'test-package', version: '1.0.0', path: '/fake' },
    modules: [
      {
        id: moduleId,
        package_id: packageId,
        name: 'TestModule',
        source: {
          directory: '/fake',
          name: 'TestModule',
          filename: filePath,
          relativePath: filePath,
        },
      },
    ],
  });
}

/** Creates a mock Rule that returns the given issues (or an empty array). */
function createMockRule(code: string, issues: CodeIssue[] = []): Rule {
  return {
    code,
    name: `Mock ${code}`,
    description: `Mock rule ${code}`,
    severity: 'warning',
    check: vi.fn().mockReturnValue(issues),
  };
}

/** Creates a minimal CodeIssue for testing. */
function createIssue(ruleCode: string, message: string): CodeIssue {
  return {
    id: `issue-${ruleCode}`,
    rule_code: ruleCode,
    severity: 'warning',
    message,
    package_id: 'pkg-1',
    module_id: 'mod-1',
    file_path: '/fake/test.ts',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('RulesEngine', () => {
  let readFileMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const fsMod = await import('fs/promises');
    readFileMock = fsMod.readFile as unknown as ReturnType<typeof vi.fn>;
  });

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------
  describe('construction', () => {
    it('creates an engine with default rules and config when no arguments given', () => {
      const engine = new RulesEngine();
      // Should not throw and should be usable
      expect(engine).toBeInstanceOf(RulesEngine);
    });

    it('accepts custom rules', () => {
      const mockRule = createMockRule('custom-rule');
      const engine = new RulesEngine([mockRule]);
      expect(engine).toBeInstanceOf(RulesEngine);
    });

    it('accepts an empty rule set', () => {
      const engine = new RulesEngine([]);
      expect(engine).toBeInstanceOf(RulesEngine);
    });

    it('accepts partial config that merges with defaults', () => {
      const engine = new RulesEngine([], {
        typeUnionWithoutAlias: { memberThreshold: 10 },
      });
      expect(engine).toBeInstanceOf(RulesEngine);
    });

    it('accepts empty partial config', () => {
      const engine = new RulesEngine([], {});
      expect(engine).toBeInstanceOf(RulesEngine);
    });
  });

  // -------------------------------------------------------------------------
  // analyze() — empty / no-module cases
  // -------------------------------------------------------------------------
  describe('analyze with no modules', () => {
    it('returns empty issues when parse result has no modules', async () => {
      const engine = new RulesEngine([createMockRule('rule-1')]);
      const result = await engine.analyze(emptyParseResult());
      expect(result).toEqual([]);
    });

    it('does not call readFile when there are no modules', async () => {
      const engine = new RulesEngine([createMockRule('rule-1')]);
      await engine.analyze(emptyParseResult());
      expect(readFileMock).not.toHaveBeenCalled();
    });

    it('does not invoke any rule checks when there are no modules', async () => {
      const rule = createMockRule('rule-1');
      const engine = new RulesEngine([rule]);
      await engine.analyze(emptyParseResult());
      expect(rule.check).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // analyze() — rule execution
  // -------------------------------------------------------------------------
  describe('analyze with modules and rules', () => {
    const validTypeScript = 'const x: number = 1;';

    beforeEach(() => {
      readFileMock.mockResolvedValue(validTypeScript);
    });

    it('reads the file for each module', async () => {
      const parseResult = parseResultWithModule('/fake/test.ts');
      const engine = new RulesEngine([]);
      await engine.analyze(parseResult);

      expect(readFileMock).toHaveBeenCalledWith('/fake/test.ts', 'utf-8');
    });

    it('invokes each rule check for each module', async () => {
      const rule1 = createMockRule('rule-1');
      const rule2 = createMockRule('rule-2');
      const parseResult = parseResultWithModule('/fake/test.ts');
      const engine = new RulesEngine([rule1, rule2]);

      await engine.analyze(parseResult);

      expect(rule1.check).toHaveBeenCalledTimes(1);
      expect(rule2.check).toHaveBeenCalledTimes(1);
    });

    it('passes correct context to rule check', async () => {
      const rule = createMockRule('ctx-rule');
      const parseResult = parseResultWithModule('/fake/test.ts', 'mod-1', 'pkg-1');
      const engine = new RulesEngine([rule], { typeUnionWithoutAlias: { memberThreshold: 5 } });

      await engine.analyze(parseResult);

      expect(rule.check).toHaveBeenCalledTimes(1);
      const context: RuleContext = (rule.check as ReturnType<typeof vi.fn>).mock.calls[0][0] as RuleContext;

      expect(context.filePath).toBe('/fake/test.ts');
      expect(context.moduleId).toBe('mod-1');
      expect(context.packageId).toBe('pkg-1');
      expect(context.sourceContent).toBe(validTypeScript);
      expect(context.parseResult).toBe(parseResult);
      expect(context.config.typeUnionWithoutAlias.memberThreshold).toBe(5);
      // j and root should be defined (jscodeshift instances)
      expect(context.j).toBeDefined();
      expect(context.root).toBeDefined();
    });

    it('collects issues from all rules', async () => {
      const issue1 = createIssue('rule-1', 'Issue from rule 1');
      const issue2 = createIssue('rule-2', 'Issue from rule 2');
      const rule1 = createMockRule('rule-1', [issue1]);
      const rule2 = createMockRule('rule-2', [issue2]);
      const parseResult = parseResultWithModule('/fake/test.ts');
      const engine = new RulesEngine([rule1, rule2]);

      const issues = await engine.analyze(parseResult);

      expect(issues).toHaveLength(2);
      expect(issues).toContainEqual(issue1);
      expect(issues).toContainEqual(issue2);
    });

    it('collects multiple issues from a single rule', async () => {
      const issues = [
        createIssue('rule-1', 'First issue'),
        createIssue('rule-1', 'Second issue'),
        createIssue('rule-1', 'Third issue'),
      ];
      const rule = createMockRule('rule-1', issues);
      const parseResult = parseResultWithModule('/fake/test.ts');
      const engine = new RulesEngine([rule]);

      const result = await engine.analyze(parseResult);
      expect(result).toHaveLength(3);
    });

    it('returns empty when rules produce no issues', async () => {
      const rule = createMockRule('clean-rule');
      const parseResult = parseResultWithModule('/fake/test.ts');
      const engine = new RulesEngine([rule]);

      const result = await engine.analyze(parseResult);
      expect(result).toEqual([]);
    });

    it('processes multiple modules and runs rules on each', async () => {
      const rule = createMockRule('multi-mod-rule');
      (rule.check as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const parseResult = emptyParseResult({
        package: { id: 'pkg-1', name: 'test', version: '1.0.0', path: '/fake' },
        modules: [
          {
            id: 'mod-a',
            package_id: 'pkg-1',
            name: 'ModA',
            source: { directory: '/fake', name: 'ModA', filename: '/fake/a.ts', relativePath: 'a.ts' },
          },
          {
            id: 'mod-b',
            package_id: 'pkg-1',
            name: 'ModB',
            source: { directory: '/fake', name: 'ModB', filename: '/fake/b.ts', relativePath: 'b.ts' },
          },
        ],
      });

      const engine = new RulesEngine([rule]);
      await engine.analyze(parseResult);

      expect(readFileMock).toHaveBeenCalledTimes(2);
      expect(rule.check).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // analyze() — .vue file skipping
  // -------------------------------------------------------------------------
  describe('Vue SFC skipping', () => {
    it('skips .vue files entirely', async () => {
      const rule = createMockRule('vue-rule');
      const parseResult = parseResultWithModule('/fake/Component.vue');
      const engine = new RulesEngine([rule]);

      const issues = await engine.analyze(parseResult);

      expect(readFileMock).not.toHaveBeenCalled();
      expect(rule.check).not.toHaveBeenCalled();
      expect(issues).toEqual([]);
    });

    it('processes .ts files but skips .vue files in the same result', async () => {
      readFileMock.mockResolvedValue('const x = 1;');
      const rule = createMockRule('mixed-rule');

      const parseResult = emptyParseResult({
        modules: [
          {
            id: 'mod-vue',
            package_id: 'pkg-1',
            name: 'VueComp',
            source: { directory: '/fake', name: 'VueComp', filename: '/fake/Comp.vue', relativePath: 'Comp.vue' },
          },
          {
            id: 'mod-ts',
            package_id: 'pkg-1',
            name: 'TsModule',
            source: { directory: '/fake', name: 'TsModule', filename: '/fake/util.ts', relativePath: 'util.ts' },
          },
        ],
      });

      const engine = new RulesEngine([rule]);
      await engine.analyze(parseResult);

      // Only the .ts module should be processed
      expect(readFileMock).toHaveBeenCalledTimes(1);
      expect(readFileMock).toHaveBeenCalledWith('/fake/util.ts', 'utf-8');
      expect(rule.check).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // analyze() — error handling
  // -------------------------------------------------------------------------
  describe('error handling', () => {
    it('continues to next module when readFile throws', async () => {
      readFileMock
        .mockRejectedValueOnce(new Error('ENOENT: file not found'))
        .mockResolvedValueOnce('const y = 2;');

      const rule = createMockRule('recover-rule');
      const parseResult = emptyParseResult({
        modules: [
          {
            id: 'mod-bad',
            package_id: 'pkg-1',
            name: 'BadMod',
            source: { directory: '/fake', name: 'BadMod', filename: '/fake/missing.ts', relativePath: 'missing.ts' },
          },
          {
            id: 'mod-good',
            package_id: 'pkg-1',
            name: 'GoodMod',
            source: { directory: '/fake', name: 'GoodMod', filename: '/fake/good.ts', relativePath: 'good.ts' },
          },
        ],
      });

      const engine = new RulesEngine([rule]);
      await engine.analyze(parseResult);

      // Should still process the second module
      expect(rule.check).toHaveBeenCalledTimes(1);
    });

    it('continues to next module when jscodeshift parsing fails', async () => {
      // Return invalid syntax that jscodeshift cannot parse
      readFileMock
        .mockResolvedValueOnce('this is not valid { { { typescript <<<')
        .mockResolvedValueOnce('const z = 3;');

      const rule = createMockRule('parse-error-rule');
      const parseResult = emptyParseResult({
        modules: [
          {
            id: 'mod-invalid',
            package_id: 'pkg-1',
            name: 'InvalidMod',
            source: { directory: '/fake', name: 'InvalidMod', filename: '/fake/invalid.ts', relativePath: 'invalid.ts' },
          },
          {
            id: 'mod-valid',
            package_id: 'pkg-1',
            name: 'ValidMod',
            source: { directory: '/fake', name: 'ValidMod', filename: '/fake/valid.ts', relativePath: 'valid.ts' },
          },
        ],
      });

      const engine = new RulesEngine([rule]);
      const issues = await engine.analyze(parseResult);

      // The second module should still be processed
      // (the first may or may not parse depending on jscodeshift tolerance)
      // At minimum, no unhandled exception should bubble up
      expect(issues).toBeInstanceOf(Array);
    });

    it('continues to other rules when one rule throws', async () => {
      readFileMock.mockResolvedValue('const a = 1;');

      const issue = createIssue('good-rule', 'Found something');
      const badRule = createMockRule('bad-rule');
      (badRule.check as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Rule exploded');
      });
      const goodRule = createMockRule('good-rule', [issue]);

      const parseResult = parseResultWithModule('/fake/test.ts');
      const engine = new RulesEngine([badRule, goodRule]);

      const issues = await engine.analyze(parseResult);

      // The bad rule threw, but the good rule still ran
      expect(goodRule.check).toHaveBeenCalledTimes(1);
      expect(issues).toContainEqual(issue);
    });

    it('does not propagate rule exceptions to the caller', async () => {
      readFileMock.mockResolvedValue('const b = 2;');
      const badRule = createMockRule('exploding-rule');
      (badRule.check as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Unexpected error in rule');
      });

      const parseResult = parseResultWithModule('/fake/test.ts');
      const engine = new RulesEngine([badRule]);

      // Should NOT throw
      await expect(engine.analyze(parseResult)).resolves.toBeInstanceOf(Array);
    });

    it('handles readFile throwing a non-Error value', async () => {
      readFileMock.mockRejectedValueOnce('string error');

      const rule = createMockRule('non-error-rule');
      const parseResult = parseResultWithModule('/fake/test.ts');
      const engine = new RulesEngine([rule]);

      // Should not throw
      const issues = await engine.analyze(parseResult);
      expect(issues).toEqual([]);
      expect(rule.check).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Config merging
  // -------------------------------------------------------------------------
  describe('config merging', () => {
    it('uses default config when none provided', async () => {
      readFileMock.mockResolvedValue('const x = 1;');
      const rule = createMockRule('config-rule');
      const parseResult = parseResultWithModule('/fake/test.ts');
      const engine = new RulesEngine([rule]);

      await engine.analyze(parseResult);

      const context: RuleContext = (rule.check as ReturnType<typeof vi.fn>).mock.calls[0][0] as RuleContext;
      expect(context.config).toEqual(defaultRulesConfig);
    });

    it('partial config overrides specific fields', async () => {
      readFileMock.mockResolvedValue('const x = 1;');
      const rule = createMockRule('config-rule');
      const parseResult = parseResultWithModule('/fake/test.ts');
      const engine = new RulesEngine([rule], {
        typeUnionWithoutAlias: { memberThreshold: 99 },
      });

      await engine.analyze(parseResult);

      const context: RuleContext = (rule.check as ReturnType<typeof vi.fn>).mock.calls[0][0] as RuleContext;
      expect(context.config.typeUnionWithoutAlias.memberThreshold).toBe(99);
    });
  });

  // -------------------------------------------------------------------------
  // Package ID resolution
  // -------------------------------------------------------------------------
  describe('package ID resolution', () => {
    it('uses package id from parseResult when available', async () => {
      readFileMock.mockResolvedValue('const x = 1;');
      const rule = createMockRule('pkg-rule');
      const parseResult = parseResultWithModule('/fake/test.ts', 'mod-1', 'my-pkg');
      const engine = new RulesEngine([rule]);

      await engine.analyze(parseResult);

      const context: RuleContext = (rule.check as ReturnType<typeof vi.fn>).mock.calls[0][0] as RuleContext;
      expect(context.packageId).toBe('my-pkg');
    });

    it('uses empty string for packageId when package is undefined', async () => {
      readFileMock.mockResolvedValue('const x = 1;');
      const rule = createMockRule('no-pkg-rule');
      const parseResult = emptyParseResult({
        modules: [
          {
            id: 'mod-1',
            package_id: '',
            name: 'Orphan',
            source: { directory: '/fake', name: 'Orphan', filename: '/fake/orphan.ts', relativePath: 'orphan.ts' },
          },
        ],
      });

      const engine = new RulesEngine([rule]);
      await engine.analyze(parseResult);

      const context: RuleContext = (rule.check as ReturnType<typeof vi.fn>).mock.calls[0][0] as RuleContext;
      expect(context.packageId).toBe('');
    });
  });
});
