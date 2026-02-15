import type { Collection, JSCodeshift } from 'jscodeshift';

import type { ParseResult } from '../parsers/ParseResult';
import type { RulesConfig } from './RulesConfig';

export type IssueSeverity = 'info' | 'warning' | 'error';

export interface CodeIssue {
  id: string;
  rule_code: string;
  severity: IssueSeverity;
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

export interface RuleContext {
  j: JSCodeshift;
  root: Collection;
  parseResult: ParseResult;
  packageId: string;
  moduleId: string;
  filePath: string;
  sourceContent: string;
  config: RulesConfig;
}

export interface Rule {
  code: string;
  name: string;
  description: string;
  severity: IssueSeverity;
  check(context: RuleContext): CodeIssue[];
}
