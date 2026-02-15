import { readFile } from 'fs/promises';

import jscodeshift from 'jscodeshift';

import { createLogger } from '../../shared/utils/logger';
import { defaultRulesConfig } from './RulesConfig';
import { allRules } from './rules/index';

import type { ParseResult } from '../parsers/ParseResult';
import type { CodeIssue, Rule } from './Rule';
import type { RulesConfig } from './RulesConfig';

export class RulesEngine {
  private readonly rules: Rule[];
  private readonly config: RulesConfig;
  private readonly logger = createLogger('RulesEngine');
  private readonly j = jscodeshift.withParser('tsx');

  constructor(rules?: Rule[], config?: Partial<RulesConfig>) {
    this.rules = rules ?? allRules;
    this.config = { ...defaultRulesConfig, ...config };
  }

  async analyze(parseResult: ParseResult): Promise<CodeIssue[]> {
    const issues: CodeIssue[] = [];
    const packageId = parseResult.package?.id ?? '';

    for (const mod of parseResult.modules) {
      const filePath = mod.source.filename;
      let sourceContent: string;

      try {
        sourceContent = await readFile(filePath, 'utf-8');
      } catch (error) {
        this.logger.warn(
          `Could not read file for rules analysis: ${filePath}`,
          error instanceof Error ? error.message : String(error)
        );
        continue;
      }

      let root;
      try {
        root = this.j(sourceContent);
      } catch (error) {
        this.logger.warn(
          `Could not parse file for rules analysis: ${filePath}`,
          error instanceof Error ? error.message : String(error)
        );
        continue;
      }

      for (const rule of this.rules) {
        try {
          const ruleIssues = rule.check({
            j: this.j,
            root,
            parseResult,
            packageId,
            moduleId: mod.id,
            filePath,
            sourceContent,
            config: this.config,
          });
          issues.push(...ruleIssues);
        } catch (error) {
          this.logger.error(
            `Rule '${rule.code}' failed on ${filePath}:`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }

    this.logger.info(`Analysis complete: ${String(issues.length)} issues found across ${String(parseResult.modules.length)} modules`);
    return issues;
  }
}
