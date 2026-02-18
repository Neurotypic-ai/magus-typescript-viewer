import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock fs/promises before importing the engine
// ---------------------------------------------------------------------------
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

// Mock the transforms index so we control exactly which transforms are loaded
vi.mock('../transforms/index', () => ({
  allTransforms: [],
}));

import { readFile, writeFile } from 'fs/promises';
import { allTransforms } from '../transforms/index';
import { RefactorEngine } from '../RefactorEngine';

import type { Mock } from 'vitest';
import type { Transform } from '../Transform';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockReadFile = readFile as Mock;
const mockWriteFile = writeFile as Mock;

function makeTransform(overrides: Partial<Transform> & { action: string }): Transform {
  return {
    name: overrides.name ?? overrides.action,
    description: overrides.description ?? 'test transform',
    execute: overrides.execute ?? vi.fn((_j, root) => root.toSource()),
    ...overrides,
  };
}

/**
 * Injects a transform into the mocked allTransforms array and returns a
 * fresh RefactorEngine that will pick it up.
 */
function engineWith(...transforms: Transform[]): RefactorEngine {
  // Clear and re-populate the mocked array so the engine picks them up
  const mutableTransforms = allTransforms as unknown as Transform[];
  mutableTransforms.length = 0;
  for (const t of transforms) {
    mutableTransforms.push(t);
  }
  return new RefactorEngine();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('RefactorEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Unknown action
  // -------------------------------------------------------------------------
  describe('when the action is unknown', () => {
    it('preview returns an error result', async () => {
      const engine = engineWith(); // no transforms registered

      const result = await engine.preview({
        filePath: '/tmp/test.ts',
        action: 'non-existent-action',
        context: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown transform action');
      expect(result.error).toContain('non-existent-action');
      expect(result.originalSource).toBe('');
    });

    it('execute returns an error result', async () => {
      const engine = engineWith();

      const result = await engine.execute({
        filePath: '/tmp/test.ts',
        action: 'missing',
        context: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown transform action');
    });
  });

  // -------------------------------------------------------------------------
  // File read failure
  // -------------------------------------------------------------------------
  describe('when the file cannot be read', () => {
    it('returns an error result with the underlying message', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT: no such file'));

      const transform = makeTransform({ action: 'test-action' });
      const engine = engineWith(transform);

      const result = await engine.preview({
        filePath: '/tmp/missing.ts',
        action: 'test-action',
        context: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not read file');
      expect(result.error).toContain('ENOENT');
      expect(result.originalSource).toBe('');
    });

    it('handles non-Error thrown values', async () => {
      mockReadFile.mockRejectedValue('raw string error');

      const transform = makeTransform({ action: 'test-action' });
      const engine = engineWith(transform);

      const result = await engine.preview({
        filePath: '/tmp/missing.ts',
        action: 'test-action',
        context: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not read file');
      expect(result.error).toContain('raw string error');
    });
  });

  // -------------------------------------------------------------------------
  // Transform execution failure
  // -------------------------------------------------------------------------
  describe('when the transform throws', () => {
    it('returns an error result with the transform error message', async () => {
      const source = 'const x = 1;';
      mockReadFile.mockResolvedValue(source);

      const transform = makeTransform({
        action: 'blow-up',
        execute: () => {
          throw new Error('Transform logic failed');
        },
      });
      const engine = engineWith(transform);

      const result = await engine.preview({
        filePath: '/tmp/test.ts',
        action: 'blow-up',
        context: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Transform failed');
      expect(result.error).toContain('Transform logic failed');
      expect(result.originalSource).toBe(source);
      expect(result.transformedSource).toBeUndefined();
    });

    it('handles non-Error thrown values from the transform', async () => {
      mockReadFile.mockResolvedValue('const x = 1;');

      const transform = makeTransform({
        action: 'blow-up',
        execute: () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 42;
        },
      });
      const engine = engineWith(transform);

      const result = await engine.preview({
        filePath: '/tmp/test.ts',
        action: 'blow-up',
        context: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Transform failed');
      expect(result.error).toContain('42');
    });
  });

  // -------------------------------------------------------------------------
  // Transform produces invalid syntax
  // -------------------------------------------------------------------------
  describe('when the transform produces invalid syntax', () => {
    it('returns an error with the original and transformed sources', async () => {
      const source = 'const x = 1;';
      mockReadFile.mockResolvedValue(source);

      const transform = makeTransform({
        action: 'bad-syntax',
        execute: () => 'const x = {{{;',
      });
      const engine = engineWith(transform);

      const result = await engine.preview({
        filePath: '/tmp/test.ts',
        action: 'bad-syntax',
        context: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Transform produced invalid syntax');
      expect(result.originalSource).toBe(source);
      expect(result.transformedSource).toBe('const x = {{{;');
    });
  });

  // -------------------------------------------------------------------------
  // Successful preview (no file write)
  // -------------------------------------------------------------------------
  describe('preview (successful)', () => {
    it('returns the transformed source without writing to disk', async () => {
      const source = 'const x = 1;';
      const transformed = 'const x = 2;';
      mockReadFile.mockResolvedValue(source);

      const transform = makeTransform({
        action: 'increment',
        execute: () => transformed,
      });
      const engine = engineWith(transform);

      const result = await engine.preview({
        filePath: '/tmp/test.ts',
        action: 'increment',
        context: {},
      });

      expect(result.success).toBe(true);
      expect(result.originalSource).toBe(source);
      expect(result.transformedSource).toBe(transformed);
      expect(result.error).toBeUndefined();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('passes the correct arguments to the transform execute', async () => {
      const source = 'const a = true;';
      mockReadFile.mockResolvedValue(source);

      const executeFn = vi.fn((_j, root) => root.toSource());
      const transform = makeTransform({
        action: 'spy-transform',
        execute: executeFn,
      });
      const engine = engineWith(transform);
      const context = { foo: 'bar' };

      await engine.preview({
        filePath: '/tmp/test.ts',
        action: 'spy-transform',
        context,
      });

      expect(executeFn).toHaveBeenCalledTimes(1);
      const [j, root, passedSource, passedContext] = executeFn.mock.calls[0] as unknown[];
      expect(typeof j).toBe('function'); // JSCodeshift is a function
      expect(root).toBeDefined();
      expect(passedSource).toBe(source);
      expect(passedContext).toBe(context);
    });
  });

  // -------------------------------------------------------------------------
  // Successful execute (writes to file)
  // -------------------------------------------------------------------------
  describe('execute (successful)', () => {
    it('writes the transformed source to the file', async () => {
      const source = 'let y = 0;';
      const transformed = 'const y = 0;';
      mockReadFile.mockResolvedValue(source);
      mockWriteFile.mockResolvedValue(undefined);

      const transform = makeTransform({
        action: 'to-const',
        execute: () => transformed,
      });
      const engine = engineWith(transform);

      const result = await engine.execute({
        filePath: '/tmp/test.ts',
        action: 'to-const',
        context: {},
      });

      expect(result.success).toBe(true);
      expect(result.transformedSource).toBe(transformed);
      expect(mockWriteFile).toHaveBeenCalledWith('/tmp/test.ts', transformed, 'utf-8');
    });
  });

  // -------------------------------------------------------------------------
  // File write failure during execute
  // -------------------------------------------------------------------------
  describe('when the file write fails during execute', () => {
    it('returns an error result with both original and transformed sources', async () => {
      const source = 'const z = 3;';
      const transformed = 'const z = 4;';
      mockReadFile.mockResolvedValue(source);
      mockWriteFile.mockRejectedValue(new Error('EACCES: permission denied'));

      const transform = makeTransform({
        action: 'mutate',
        execute: () => transformed,
      });
      const engine = engineWith(transform);

      const result = await engine.execute({
        filePath: '/tmp/readonly.ts',
        action: 'mutate',
        context: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not write file');
      expect(result.error).toContain('EACCES');
      expect(result.originalSource).toBe(source);
      expect(result.transformedSource).toBe(transformed);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple transforms registered
  // -------------------------------------------------------------------------
  describe('when multiple transforms are registered', () => {
    it('dispatches to the correct transform by action', async () => {
      const source = 'const v = 1;';
      mockReadFile.mockResolvedValue(source);

      const transformA = makeTransform({
        action: 'action-a',
        execute: () => '// A',
      });
      const transformB = makeTransform({
        action: 'action-b',
        execute: () => '// B',
      });
      const engine = engineWith(transformA, transformB);

      const resultA = await engine.preview({
        filePath: '/tmp/test.ts',
        action: 'action-a',
        context: {},
      });
      const resultB = await engine.preview({
        filePath: '/tmp/test.ts',
        action: 'action-b',
        context: {},
      });

      expect(resultA.transformedSource).toBe('// A');
      expect(resultB.transformedSource).toBe('// B');
    });
  });

  // -------------------------------------------------------------------------
  // Identity transform (source unchanged)
  // -------------------------------------------------------------------------
  describe('identity transform', () => {
    it('succeeds when the transform returns the source unchanged', async () => {
      const source = 'const x = 1;\n';
      mockReadFile.mockResolvedValue(source);

      const transform = makeTransform({
        action: 'noop',
        execute: (_j, root) => root.toSource(),
      });
      const engine = engineWith(transform);

      const result = await engine.preview({
        filePath: '/tmp/test.ts',
        action: 'noop',
        context: {},
      });

      expect(result.success).toBe(true);
      expect(result.transformedSource).toBe(source);
    });
  });
});
