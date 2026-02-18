// @vitest-environment node
import { vi } from 'vitest';

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

  it('propagates errors from readFileSync', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    const { loadSchema } = await import('../schema-loader');
    expect(() => loadSchema()).toThrow('ENOENT');
  });

  it('returns an empty string when schema file is empty', async () => {
    mockReadFileSync.mockReturnValue('');

    const { loadSchema } = await import('../schema-loader');
    const result = loadSchema();
    expect(result).toBe('');
  });

  it('returns whatever readFileSync provides without validation', async () => {
    mockReadFileSync.mockReturnValue('not valid sql at all');

    const { loadSchema } = await import('../schema-loader');
    const result = loadSchema();
    expect(result).toBe('not valid sql at all');
  });

  it('passes utf-8 encoding to readFileSync', async () => {
    mockReadFileSync.mockReturnValue('CREATE TABLE test (id INT);');

    const { loadSchema } = await import('../schema-loader');
    loadSchema();

    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    expect(mockReadFileSync).toHaveBeenCalledWith(expect.any(String), 'utf-8');
  });

  it('reads from a path ending in schema.sql', async () => {
    mockReadFileSync.mockReturnValue('CREATE TABLE test (id INT);');

    const { loadSchema } = await import('../schema-loader');
    loadSchema();

    const calledPath = mockReadFileSync.mock.calls[0][0] as string;
    expect(calledPath).toMatch(/schema\.sql$/);
  });

  it('handles readFileSync returning content with unusual whitespace', async () => {
    mockReadFileSync.mockReturnValue('  \n\n  CREATE TABLE foo (id INT);  \n\n  ');

    const { loadSchema } = await import('../schema-loader');
    const result = loadSchema();
    expect(result).toBe('  \n\n  CREATE TABLE foo (id INT);  \n\n  ');
  });
});
