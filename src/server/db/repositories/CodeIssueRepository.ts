import { BaseRepository } from './BaseRepository';

import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';

export interface ICodeIssueRow {
  [key: string]: string | number | null;
  id: string;
  rule_code: string;
  severity: string;
  message: string;
  suggestion: string | null;
  package_id: string;
  module_id: string;
  file_path: string;
  entity_id: string | null;
  entity_type: string | null;
  entity_name: string | null;
  parent_entity_id: string | null;
  parent_entity_type: string | null;
  parent_entity_name: string | null;
  property_name: string | null;
  line: number | null;
  column: number | null;
  refactor_action: string | null;
  refactor_context_json: string | null;
  created_at: string;
}

export interface ICodeIssueCreateDTO {
  id: string;
  rule_code: string;
  severity: string;
  message: string;
  suggestion?: string | undefined;
  package_id: string;
  module_id: string;
  file_path: string;
  entity_id?: string | undefined;
  entity_type?: string | undefined;
  entity_name?: string | undefined;
  parent_entity_id?: string | undefined;
  parent_entity_type?: string | undefined;
  parent_entity_name?: string | undefined;
  property_name?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  refactor_action?: string | undefined;
  refactor_context_json?: string | undefined;
}

export interface CodeIssueEntity {
  id: string;
  rule_code: string;
  severity: string;
  message: string;
  suggestion?: string;
  package_id: string;
  module_id: string;
  file_path: string;
  entity_id?: string;
  entity_type?: string;
  entity_name?: string;
  parent_entity_id?: string;
  parent_entity_type?: string;
  parent_entity_name?: string;
  property_name?: string;
  line?: number;
  column?: number;
  refactor_action?: string;
  refactor_context?: Record<string, unknown>;
}

type ICodeIssueUpdateDTO = Record<string, never>;

export class CodeIssueRepository extends BaseRepository<CodeIssueEntity, ICodeIssueCreateDTO, ICodeIssueUpdateDTO> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[CodeIssueRepository]', 'code_issues');
  }

  async createBatch(items: ICodeIssueCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, rule_code, severity, message, suggestion, package_id, module_id, file_path, entity_id, entity_type, entity_name, parent_entity_id, parent_entity_type, parent_entity_name, property_name, line, "column", refactor_action, refactor_context_json)',
      19,
      items,
      (dto) => [
        dto.id,
        dto.rule_code,
        dto.severity,
        dto.message,
        dto.suggestion ?? null,
        dto.package_id,
        dto.module_id,
        dto.file_path,
        dto.entity_id ?? null,
        dto.entity_type ?? null,
        dto.entity_name ?? null,
        dto.parent_entity_id ?? null,
        dto.parent_entity_type ?? null,
        dto.parent_entity_name ?? null,
        dto.property_name ?? null,
        dto.line ?? null,
        dto.column ?? null,
        dto.refactor_action ?? null,
        dto.refactor_context_json ?? null,
      ]
    );
  }

  async create(dto: ICodeIssueCreateDTO): Promise<CodeIssueEntity> {
    const results = await this.executeQuery<ICodeIssueRow>(
      'create',
      'INSERT INTO code_issues (id, rule_code, severity, message, suggestion, package_id, module_id, file_path, entity_id, entity_type, entity_name, parent_entity_id, parent_entity_type, parent_entity_name, property_name, line, "column", refactor_action, refactor_context_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
      [
        dto.id, dto.rule_code, dto.severity, dto.message, dto.suggestion ?? null,
        dto.package_id, dto.module_id, dto.file_path,
        dto.entity_id ?? null, dto.entity_type ?? null, dto.entity_name ?? null,
        dto.parent_entity_id ?? null, dto.parent_entity_type ?? null, dto.parent_entity_name ?? null,
        dto.property_name ?? null, dto.line ?? null, dto.column ?? null,
        dto.refactor_action ?? null, dto.refactor_context_json ?? null,
      ]
    );
    const row = results[0];
    if (!row) {
      throw new Error('Failed to create code issue');
    }
    return this.mapToEntity(row);
  }

  update(_id: string, _dto: ICodeIssueUpdateDTO): Promise<CodeIssueEntity> {
    throw new Error('Not supported for CodeIssueRepository');
  }

  async retrieveById(id: string): Promise<CodeIssueEntity | undefined> {
    const results = await this.executeQuery<ICodeIssueRow>(
      'retrieveById',
      'SELECT * FROM code_issues WHERE id = ?',
      [id]
    );
    const row = results[0];
    return row ? this.mapToEntity(row) : undefined;
  }

  async retrieveByModuleId(moduleId: string): Promise<CodeIssueEntity[]> {
    const results = await this.executeQuery<ICodeIssueRow>(
      'retrieveByModuleId',
      'SELECT * FROM code_issues WHERE module_id = ?',
      [moduleId]
    );
    return results.map((row) => this.mapToEntity(row));
  }

  async retrieve(): Promise<CodeIssueEntity[]> {
    const results = await this.executeQuery<ICodeIssueRow>(
      'retrieveAll',
      'SELECT * FROM code_issues ORDER BY rule_code, file_path'
    );
    return results.map((row) => this.mapToEntity(row));
  }

  async delete(id: string): Promise<void> {
    await this.executeQuery('delete', 'DELETE FROM code_issues WHERE id = ?', [id]);
  }

  async deleteByPackageId(packageId: string): Promise<void> {
    await this.executeQuery('deleteByPackageId', 'DELETE FROM code_issues WHERE package_id = ?', [packageId]);
  }

  private mapToEntity(row: ICodeIssueRow): CodeIssueEntity {
    let refactorContext: Record<string, unknown> | undefined;
    if (row.refactor_context_json) {
      try {
        refactorContext = JSON.parse(row.refactor_context_json) as Record<string, unknown>;
      } catch {
        // Invalid JSON — leave as undefined
      }
    }

    return {
      id: row.id,
      rule_code: row.rule_code,
      severity: row.severity,
      message: row.message,
      ...(row.suggestion ? { suggestion: row.suggestion } : {}),
      package_id: row.package_id,
      module_id: row.module_id,
      file_path: row.file_path,
      ...(row.entity_id ? { entity_id: row.entity_id } : {}),
      ...(row.entity_type ? { entity_type: row.entity_type } : {}),
      ...(row.entity_name ? { entity_name: row.entity_name } : {}),
      ...(row.parent_entity_id ? { parent_entity_id: row.parent_entity_id } : {}),
      ...(row.parent_entity_type ? { parent_entity_type: row.parent_entity_type } : {}),
      ...(row.parent_entity_name ? { parent_entity_name: row.parent_entity_name } : {}),
      ...(row.property_name ? { property_name: row.property_name } : {}),
      ...(row.line !== null ? { line: row.line } : {}),
      ...(row.column !== null ? { column: row.column } : {}),
      ...(row.refactor_action ? { refactor_action: row.refactor_action } : {}),
      ...(refactorContext ? { refactor_context: refactorContext } : {}),
    };
  }
}
