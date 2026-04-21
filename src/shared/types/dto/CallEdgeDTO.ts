export type CallResolutionStatus = 'resolved' | 'ambiguous' | 'unresolved' | 'external';
export type CallEndpointType = 'method' | 'function';

/**
 * Directed edge in the function/method call graph.
 * Unresolved or external targets keep the target_name for later inspection.
 */
export interface ICallEdgeCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  source_entity_id: string;
  source_entity_type: CallEndpointType;
  target_entity_id?: string;
  target_entity_type?: CallEndpointType;
  target_name?: string;
  target_qualifier?: string;
  call_expression_line?: number;
  is_async_call?: boolean;
  is_awaited?: boolean;
  resolution_status: CallResolutionStatus;
}

export interface ICallEdgeRow {
  id: string;
  package_id: string;
  module_id: string;
  source_entity_id: string;
  source_entity_type: CallEndpointType;
  target_entity_id: string | null;
  target_entity_type: CallEndpointType | null;
  target_name: string | null;
  target_qualifier: string | null;
  call_expression_line: number | null;
  is_async_call: boolean;
  is_awaited: boolean;
  resolution_status: CallResolutionStatus;
  created_at: string;
}
