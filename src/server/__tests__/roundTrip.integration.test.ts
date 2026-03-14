// @vitest-environment node
/**
 * Round-trip integration test: Parse → Rule.check → Transform → Re-check
 *
 * Uses real parsers, rules, and transforms — no mocks. Verifies that:
 *  1. The rule detects inline union types
 *  2. The transform extracts them to named aliases
 *  3. Re-running the rule on the transformed source finds zero issues
 */
import jscodeshift from 'jscodeshift';
import { describe, expect, it } from 'vitest';

import { ModuleParser } from '../parsers/ModuleParser';
import { typeUnionWithoutAlias } from '../rules/rules/typeUnionWithoutAlias';
import { extractTypeUnion } from '../refactors/transforms/extractTypeUnion';
import { defaultRulesConfig } from '../rules/RulesConfig';

import type { RuleContext } from '../rules/Rule';
import type { ParseResult } from '../parsers/ParseResult';

const j = jscodeshift.withParser('tsx');

const PACKAGE_ID = 'pkg-round-trip';
const FILE_PATH = 'virtual://ApiConfig.ts';

const SOURCE = `export interface ApiConfig {
  method: "GET" | "POST" | "PUT" | "DELETE";
  format: "json" | "xml" | "csv";
  version: string;
}`.trim();

/** Parse a source string using ModuleParser (uses sourceOverride, no disk access). */
async function parseSource(source: string): Promise<ParseResult> {
  return new ModuleParser(FILE_PATH, PACKAGE_ID, source).parse();
}

/** Build a RuleContext from a parsed result and source string. */
function makeContext(source: string, parseResult: ParseResult): RuleContext {
  // moduleId is the one stored in the DTOs
  const moduleId = parseResult.interfaces[0]?.module_id ?? parseResult.classes[0]?.module_id ?? '';

  return {
    j,
    root: j(source),
    parseResult,
    packageId: PACKAGE_ID,
    moduleId,
    filePath: FILE_PATH,
    sourceContent: source,
    config: defaultRulesConfig,
  };
}

describe('Rule → Transform → Re-check round trip', () => {
  it('detects 2 union issues on ApiConfig (method + format)', async () => {
    const parseResult = await parseSource(SOURCE);
    const context = makeContext(SOURCE, parseResult);
    const issues = typeUnionWithoutAlias.check(context);

    expect(issues).toHaveLength(2);
    const names = issues.map((i) => i.entity_name).sort();
    expect(names).toEqual(['format', 'method']);
  });

  it('both detected issues reference the ApiConfig interface', async () => {
    const parseResult = await parseSource(SOURCE);
    const context = makeContext(SOURCE, parseResult);
    const issues = typeUnionWithoutAlias.check(context);

    for (const issue of issues) {
      expect(issue.parent_entity_name).toBe('ApiConfig');
      expect(issue.parent_entity_type).toBe('interface');
    }
  });

  it('extract transform produces valid TypeScript for each detected issue', async () => {
    const parseResult = await parseSource(SOURCE);
    const context = makeContext(SOURCE, parseResult);
    const issues = typeUnionWithoutAlias.check(context);

    let current = SOURCE;
    for (const issue of issues) {
      current = extractTypeUnion.execute(j, j(current), current, issue.refactor_context as Record<string, unknown>);
    }

    // Re-parse — should not throw
    expect(() => j(current)).not.toThrow();
  });

  it('re-running the rule on transformed source finds zero union issues on the same properties', async () => {
    // Step 1: Parse original source
    const parseResult = await parseSource(SOURCE);
    const context = makeContext(SOURCE, parseResult);

    // Step 2: Detect issues
    const issues = typeUnionWithoutAlias.check(context);
    expect(issues.length).toBeGreaterThan(0);

    // Step 3: Apply each transform sequentially
    let transformedSource = SOURCE;
    for (const issue of issues) {
      transformedSource = extractTypeUnion.execute(
        j,
        j(transformedSource),
        transformedSource,
        issue.refactor_context as Record<string, unknown>,
      );
    }

    // Step 4: Re-parse transformed source
    const transformedParseResult = await parseSource(transformedSource);
    const transformedContext = makeContext(transformedSource, transformedParseResult);

    // Step 5: Re-run the rule — expect zero issues on the previously-detected properties
    const remainingIssues = typeUnionWithoutAlias.check(transformedContext);
    const remainingOnApiConfig = remainingIssues.filter(
      (i) => i.parent_entity_name === 'ApiConfig' && ['method', 'format'].includes(i.entity_name),
    );

    expect(remainingOnApiConfig).toHaveLength(0);
  });

  it('type aliases are inserted before the interface declaration', async () => {
    const parseResult = await parseSource(SOURCE);
    const context = makeContext(SOURCE, parseResult);
    const issues = typeUnionWithoutAlias.check(context);

    let transformed = SOURCE;
    for (const issue of issues) {
      transformed = extractTypeUnion.execute(
        j,
        j(transformed),
        transformed,
        issue.refactor_context as Record<string, unknown>,
      );
    }

    const interfaceIndex = transformed.indexOf('interface ApiConfig');
    expect(interfaceIndex).toBeGreaterThan(-1);

    // Both type aliases must appear before the interface
    for (const issue of issues) {
      const ctx = issue.refactor_context as { suggestedName: string };
      const aliasIndex = transformed.indexOf(`type ${ctx.suggestedName}`);
      expect(aliasIndex).toBeGreaterThan(-1);
      expect(aliasIndex).toBeLessThan(interfaceIndex);
    }
  });

  it('non-union property (version: string) is untouched after transforms', async () => {
    const parseResult = await parseSource(SOURCE);
    const context = makeContext(SOURCE, parseResult);
    const issues = typeUnionWithoutAlias.check(context);

    let transformed = SOURCE;
    for (const issue of issues) {
      transformed = extractTypeUnion.execute(
        j,
        j(transformed),
        transformed,
        issue.refactor_context as Record<string, unknown>,
      );
    }

    // version: string should still appear on the interface, unchanged
    expect(transformed).toContain('version: string');
  });

  it('suggested type alias names follow PascalCase convention', async () => {
    const parseResult = await parseSource(SOURCE);
    const context = makeContext(SOURCE, parseResult);
    const issues = typeUnionWithoutAlias.check(context);

    for (const issue of issues) {
      const ctx = issue.refactor_context as { suggestedName: string };
      // PascalCase: starts with uppercase letter
      expect(ctx.suggestedName).toMatch(/^[A-Z]/);
      // Must contain the parent name prefix
      expect(ctx.suggestedName.startsWith('ApiConfig')).toBe(true);
    }
  });
});
