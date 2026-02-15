import type { Collection, JSCodeshift } from 'jscodeshift';

export interface TransformRequest {
  filePath: string;
  action: string;
  context: Record<string, unknown>;
}

export interface TransformResult {
  success: boolean;
  filePath: string;
  originalSource: string;
  transformedSource?: string;
  error?: string;
}

export interface Transform {
  action: string;
  name: string;
  description: string;
  execute(j: JSCodeshift, root: Collection, source: string, context: Record<string, unknown>): string;
}
