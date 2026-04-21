/**
 * RulesEngineAdapter
 *
 * Thin adapter that wraps the legacy `RulesEngine` so it can plug into the new
 * `AnalyzerPipeline` as an `Analyzer`. The existing engine and rule files are
 * left untouched; this adapter simply forwards the parse result and converts
 * each emitted `CodeIssue` into an `ICodeIssueCreateDTO` that the pipeline can
 * persist.
 *
 * The only non-trivial conversion is `refactor_context` (a structured object)
 * being serialized to the DTO's `refactor_context_json` string column.
 */
import { RulesEngine } from '../../rules/RulesEngine';

import type { CodeIssue } from '../../rules/Rule';
import type { ICodeIssueCreateDTO } from '../../../shared/types/dto/CodeIssueDTO';
import type {
  AnalysisConfig,
  Analyzer,
  AnalyzerCapability,
  AnalyzerCategory,
  AnalyzerContext,
  AnalyzerResult,
} from '../types';

/**
 * Convert a `CodeIssue` emitted by the legacy rules engine into the canonical
 * `ICodeIssueCreateDTO` shape expected by analyzer result persistence.
 */
function toCodeIssueDTO(issue: CodeIssue): ICodeIssueCreateDTO {
  const dto: ICodeIssueCreateDTO = {
    id: issue.id,
    rule_code: issue.rule_code,
    severity: issue.severity,
    message: issue.message,
    package_id: issue.package_id,
    module_id: issue.module_id,
    file_path: issue.file_path,
  };

  if (issue.suggestion !== undefined) dto.suggestion = issue.suggestion;
  if (issue.entity_id !== undefined) dto.entity_id = issue.entity_id;
  if (issue.entity_type !== undefined) dto.entity_type = issue.entity_type;
  if (issue.entity_name !== undefined) dto.entity_name = issue.entity_name;
  if (issue.parent_entity_id !== undefined) dto.parent_entity_id = issue.parent_entity_id;
  if (issue.parent_entity_type !== undefined) dto.parent_entity_type = issue.parent_entity_type;
  if (issue.parent_entity_name !== undefined) dto.parent_entity_name = issue.parent_entity_name;
  if (issue.property_name !== undefined) dto.property_name = issue.property_name;
  if (issue.line !== undefined) dto.line = issue.line;
  if (issue.column !== undefined) dto.column = issue.column;
  if (issue.refactor_action !== undefined) dto.refactor_action = issue.refactor_action;
  if (issue.refactor_context !== undefined) {
    dto.refactor_context_json = JSON.stringify(issue.refactor_context);
  }

  return dto;
}

export class RulesEngineAdapter implements Analyzer {
  public id = 'legacy-rules';
  public category: AnalyzerCategory = 'quality';
  public requires: AnalyzerCapability[] = [];

  private readonly engine: RulesEngine;

  constructor(engine?: RulesEngine) {
    this.engine = engine ?? new RulesEngine();
  }

  public enabled(_config: AnalysisConfig): boolean {
    return true;
  }

  public async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const issues = await this.engine.analyze(ctx.parseResult);
    const findings: ICodeIssueCreateDTO[] = issues.map(toCodeIssueDTO);
    return { findings };
  }
}
