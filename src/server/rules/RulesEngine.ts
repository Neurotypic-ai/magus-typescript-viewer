import { readFile } from 'fs/promises';

import jscodeshift from 'jscodeshift';

import { getErrorMessage } from '../../shared/utils/errorUtils';
import { createLogger } from '../../shared/utils/logger';
import { VueScriptExtractor } from '../parsers/VueScriptExtractor';
import { defaultRulesConfig } from './RulesConfig';
import { typeUnionWithoutAlias } from './rules/typeUnionWithoutAlias';

import type { ParseResult } from '../parsers/ParseResult';
import type { CodeIssue, Rule } from './Rule';
import type { RulesConfig } from './RulesConfig';

export class RulesEngine {
  private readonly rules: Rule[];
  private readonly config: RulesConfig;
  private readonly logger = createLogger('RulesEngine');
  private readonly j = jscodeshift.withParser('tsx');
  private readonly vueExtractor = new VueScriptExtractor();

  constructor(rules?: Rule[], config?: Partial<RulesConfig>) {
    this.rules = rules ?? [typeUnionWithoutAlias];
    this.config = {
      typeUnionWithoutAlias: {
        ...defaultRulesConfig.typeUnionWithoutAlias,
        ...config?.typeUnionWithoutAlias,
      },
    };
  }

  async analyze(parseResult: ParseResult): Promise<CodeIssue[]> {
    const issues: CodeIssue[] = [];
    const packageId = parseResult.package?.id ?? '';

    for (const mod of parseResult.modules) {
      const filePath = mod.source.filename;

      if (!filePath) {
        this.logger.warn('Module has empty file path, skipping');
        continue;
      }

      let sourceContent: string;

      if (filePath.endsWith('.vue')) {
        const extracted = await this.vueExtractor.getSourceOverride(filePath);
        if (!extracted) {
          continue;
        }
        sourceContent = extracted;
      } else {
        try {
          sourceContent = await readFile(filePath, 'utf-8');
        } catch (error) {
          this.logger.warn(
            `Could not read file for rules analysis: ${filePath}`,
            getErrorMessage(error)
          );
          continue;
        }
      }

      let root;
      try {
        root = this.j(sourceContent);
      } catch (error) {
        this.logger.warn(
          `Could not parse file for rules analysis: ${filePath}`,
          getErrorMessage(error)
        );
        continue;
      }

      for (const rule of this.rules) {
        try {
          const ruleIssues = await rule.check({
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
            getErrorMessage(error)
          );
        }
      }
    }

    this.logger.info(`Analysis complete: ${String(issues.length)} issues found across ${String(parseResult.modules.length)} modules`);
    return issues;
  }
}
