// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadSchema } from '../schema-loader';

const mockReadFileSync = vi.fn();

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
}));

describe('loadSchema with mocked filesystem', () => {
  beforeEach(() => {
    vi.resetModules();
    mockReadFileSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('propagates errors from readFileSync', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    expect(() => loadSchema()).toThrow('ENOENT');
  });

  it('returns an empty string when schema file is empty', () => {
    mockReadFileSync.mockReturnValue('');

    const result = loadSchema();
    expect(result).toBe('');
  });

  it('returns whatever readFileSync provides without validation', () => {
    mockReadFileSync.mockReturnValue('not valid sql at all');

    const result = loadSchema();
    expect(result).toBe('not valid sql at all');
  });

  it('passes utf-8 encoding to readFileSync', () => {
    mockReadFileSync.mockReturnValue('CREATE TABLE test (id INT);');

    loadSchema();

    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    expect(mockReadFileSync).toHaveBeenCalledWith(expect.any(String), 'utf-8');
  });

  it('reads from a path ending in schema.sql', () => {
    mockReadFileSync.mockReturnValue('CREATE TABLE test (id INT);');

    loadSchema();

    const calledPath = mockReadFileSync.mock.calls[0]?.[0] as string;
    expect(calledPath).toMatch(/schema\.sql$/);
  });

  it('handles readFileSync returning content with unusual whitespace', () => {
    mockReadFileSync.mockReturnValue('  \n\n  CREATE TABLE foo (id INT);  \n\n  ');

    const result = loadSchema();
    expect(result).toBe('  \n\n  CREATE TABLE foo (id INT);  \n\n  ');
  });
});
