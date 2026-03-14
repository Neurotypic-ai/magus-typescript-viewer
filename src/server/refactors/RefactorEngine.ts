import { readFile, writeFile } from 'fs/promises';
import path from 'node:path';

import jscodeshift from 'jscodeshift';

import { getErrorMessage } from '../../shared/utils/errorUtils';
import { allTransforms } from './transforms/index';

import type { Transform, TransformRequest, TransformResult } from './Transform';

const j = jscodeshift.withParser('tsx');

export class RefactorEngine {
  private readonly transforms: Record<string, Transform> = Object.fromEntries(
    allTransforms.map((t) => [t.action, t]),
  );

  constructor(private readonly projectRoot?: string) {}

  async preview(request: TransformRequest): Promise<TransformResult> {
    return this.run(request, false);
  }

  async execute(request: TransformRequest): Promise<TransformResult> {
    return this.run(request, true);
  }

  private async run(request: TransformRequest, writeToFile: boolean): Promise<TransformResult> {
    const { filePath, action, context } = request;

    if (this.projectRoot) {
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(this.projectRoot)) {
        return {
          success: false,
          filePath,
          originalSource: '',
          error: `File path '${filePath}' is outside the allowed project root`,
        };
      }
    }

    const transform = this.transforms[action];
    if (!transform) {
      return {
        success: false,
        filePath,
        originalSource: '',
        error: `Unknown transform action: ${action}`,
      };
    }

    let originalSource: string;
    try {
      originalSource = await readFile(filePath, 'utf-8');
    } catch (error) {
      return {
        success: false,
        filePath,
        originalSource: '',
        error: `Could not read file: ${getErrorMessage(error)}`,
      };
    }

    let transformedSource: string;
    try {
      const root = j(originalSource);
      transformedSource = transform.execute(j, root, originalSource, context);
    } catch (error) {
      return {
        success: false,
        filePath,
        originalSource: '',
        error: `Transform failed: ${getErrorMessage(error)}`,
      };
    }

    // Validate: re-parse the transformed source to catch syntax errors
    try {
      j(transformedSource);
    } catch (error) {
      return {
        success: false,
        filePath,
        originalSource: '',
        error: `Transform produced invalid syntax: ${getErrorMessage(error)}`,
      };
    }

    if (writeToFile) {
      try {
        await writeFile(filePath, transformedSource, 'utf-8');
      } catch (error) {
        return {
          success: false,
          filePath,
          originalSource: '',
          error: `Could not write file: ${getErrorMessage(error)}`,
        };
      }
    }

    return {
      success: true,
      filePath,
      originalSource,
      transformedSource,
    };
  }
}
