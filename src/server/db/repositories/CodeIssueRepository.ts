import { BaseRepository } from './BaseRepository';

import type { ICodeIssueCreateDTO, ICodeIssueUpdateDTO } from '../../../shared/types/dto/CodeIssueDTO';
import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';
import type { CodeIssueEntity } from '../types/CodeIssueEntity';
import type { ICodeIssueRow } from '../types/DatabaseResults';

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
    const results = await this.executeQuery<ICodeIssueRow>('retrieveById', 'SELECT * FROM code_issues WHERE id = ?', [
      id,
    ]);
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
