import { readFile, writeFile } from 'fs/promises';

import jscodeshift from 'jscodeshift';

import { createLogger } from '../../shared/utils/logger';
import { allTransforms } from './transforms/index';

import type { TransformRequest, TransformResult } from './Transform';

export class RefactorEngine {
  private readonly logger = createLogger('RefactorEngine');
  private readonly j = jscodeshift.withParser('tsx');
  private readonly transforms = new Map(allTransforms.map((t) => [t.action, t]));

  async preview(request: TransformRequest): Promise<TransformResult> {
    return this.run(request, false);
  }

  async execute(request: TransformRequest): Promise<TransformResult> {
    return this.run(request, true);
  }

  private async run(request: TransformRequest, writeToFile: boolean): Promise<TransformResult> {
    const { filePath, action, context } = request;

    const transform = this.transforms.get(action);
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
        error: `Could not read file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    let transformedSource: string;
    try {
      const root = this.j(originalSource);
      transformedSource = transform.execute(this.j, root, originalSource, context);
    } catch (error) {
      return {
        success: false,
        filePath,
        originalSource,
        error: `Transform failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Validate: re-parse the transformed source to catch syntax errors
    try {
      this.j(transformedSource);
    } catch (error) {
      return {
        success: false,
        filePath,
        originalSource,
        transformedSource,
        error: `Transform produced invalid syntax: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (writeToFile) {
      try {
        await writeFile(filePath, transformedSource, 'utf-8');
        this.logger.info(`Refactoring applied to ${filePath}`);
      } catch (error) {
        return {
          success: false,
          filePath,
          originalSource,
          transformedSource,
          error: `Could not write file: ${error instanceof Error ? error.message : String(error)}`,
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
