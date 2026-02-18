import {
  isExternalImportRef,
  normalizePath,
  getDirname,
  joinPaths,
  generatePathVariants,
  buildModulePathLookup,
  getPackagePrefixFromImporter,
  expandCandidatePath,
  resolveRelativeCandidates,
  resolveNonRelativeCandidates,
  resolveModuleId,
  EXTENSIONS,
  FILE_EXTENSION_PATTERN,
  INDEX_FILE_PATTERN,
} from '../graphEdgeLookups';

import type { ModulePathLookup } from '../graphEdgeLookups';
import type { DependencyPackageGraph } from '../../types/DependencyPackageGraph';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraph(
  modules: Record<string, { id: string; name: string; relativePath: string }>,
  packageId = 'pkg-1'
): DependencyPackageGraph {
  const moduleRecords: Record<string, { id: string; name: string; package_id: string; source: { relativePath: string } }> = {};
  for (const [key, mod] of Object.entries(modules)) {
    moduleRecords[key] = {
      id: mod.id,
      name: mod.name,
      package_id: packageId,
      source: { relativePath: mod.relativePath },
    };
  }
  return {
    packages: [
      {
        id: packageId,
        name: 'test-package',
        version: '1.0.0',
        path: '/test',
        created_at: '2024-01-01',
        modules: moduleRecords,
      },
    ],
  };
}

function emptyLookup(): ModulePathLookup {
  return { packagePathMap: new Map(), globalPathMap: new Map() };
}

// ---------------------------------------------------------------------------
// isExternalImportRef
// ---------------------------------------------------------------------------

describe('isExternalImportRef', () => {
  it('returns true when isExternal is true', () => {
    expect(isExternalImportRef({ isExternal: true })).toBe(true);
  });

  it('returns true when packageName is a non-empty string', () => {
    expect(isExternalImportRef({ packageName: 'vue' })).toBe(true);
  });

  it('returns false when packageName is empty string', () => {
    expect(isExternalImportRef({ packageName: '', path: './local' })).toBe(false);
  });

  it('returns false for relative paths starting with ./', () => {
    expect(isExternalImportRef({ path: './utils' })).toBe(false);
  });

  it('returns false for relative paths starting with ../', () => {
    expect(isExternalImportRef({ path: '../utils' })).toBe(false);
  });

  it('returns false for absolute paths starting with /', () => {
    expect(isExternalImportRef({ path: '/some/path' })).toBe(false);
  });

  it('returns false for alias paths starting with @/', () => {
    expect(isExternalImportRef({ path: '@/components/Foo' })).toBe(false);
  });

  it('returns false for paths starting with src/', () => {
    expect(isExternalImportRef({ path: 'src/utils/helpers' })).toBe(false);
  });

  it('returns true for bare module specifiers like "lodash"', () => {
    expect(isExternalImportRef({ path: 'lodash' })).toBe(true);
  });

  it('returns true for scoped packages like "@vue/reactivity"', () => {
    expect(isExternalImportRef({ path: '@vue/reactivity' })).toBe(true);
  });

  it('returns false when path is undefined and no other flags', () => {
    expect(isExternalImportRef({})).toBe(false);
    expect(isExternalImportRef({ path: undefined })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizePath
// ---------------------------------------------------------------------------

describe('normalizePath', () => {
  it('replaces backslashes with forward slashes', () => {
    expect(normalizePath('src\\utils\\helpers.ts')).toBe('src/utils/helpers.ts');
  });

  it('resolves parent directory references (..)', () => {
    expect(normalizePath('src/components/../utils/helpers.ts')).toBe('src/utils/helpers.ts');
  });

  it('removes current directory references (.)', () => {
    expect(normalizePath('src/./utils/./helpers.ts')).toBe('src/utils/helpers.ts');
  });

  it('removes empty segments from double slashes', () => {
    expect(normalizePath('src//utils//helpers.ts')).toBe('src/utils/helpers.ts');
  });

  it('handles a simple filename', () => {
    expect(normalizePath('file.ts')).toBe('file.ts');
  });

  it('returns empty string for empty input', () => {
    expect(normalizePath('')).toBe('');
  });

  it('returns empty string for just a dot', () => {
    expect(normalizePath('.')).toBe('');
  });

  it('resolves multiple consecutive parent references', () => {
    expect(normalizePath('a/b/c/../../d')).toBe('a/d');
  });
});

// ---------------------------------------------------------------------------
// getDirname
// ---------------------------------------------------------------------------

describe('getDirname', () => {
  it('returns directory portion of a path', () => {
    expect(getDirname('src/utils/helpers.ts')).toBe('src/utils');
  });

  it('returns empty string for a bare filename', () => {
    expect(getDirname('helpers.ts')).toBe('');
  });

  it('handles deeply nested paths', () => {
    expect(getDirname('a/b/c/d/file.ts')).toBe('a/b/c/d');
  });

  it('normalizes the path before extracting dirname', () => {
    expect(getDirname('src\\utils\\helpers.ts')).toBe('src/utils');
  });
});

// ---------------------------------------------------------------------------
// joinPaths
// ---------------------------------------------------------------------------

describe('joinPaths', () => {
  it('joins two segments', () => {
    expect(joinPaths('src', 'utils')).toBe('src/utils');
  });

  it('joins multiple segments', () => {
    expect(joinPaths('src', 'client', 'utils', 'helpers.ts')).toBe('src/client/utils/helpers.ts');
  });

  it('normalizes the result', () => {
    expect(joinPaths('src/components', '../utils')).toBe('src/utils');
  });

  it('handles a single segment', () => {
    expect(joinPaths('src')).toBe('src');
  });
});

// ---------------------------------------------------------------------------
// Regex patterns (exported constants)
// ---------------------------------------------------------------------------

describe('EXTENSIONS', () => {
  it('contains expected file extensions', () => {
    expect(EXTENSIONS).toContain('.ts');
    expect(EXTENSIONS).toContain('.tsx');
    expect(EXTENSIONS).toContain('.js');
    expect(EXTENSIONS).toContain('.jsx');
    expect(EXTENSIONS).toContain('.mjs');
    expect(EXTENSIONS).toContain('.cjs');
    expect(EXTENSIONS).toContain('.vue');
    expect(EXTENSIONS).toHaveLength(7);
  });
});

describe('FILE_EXTENSION_PATTERN', () => {
  it('matches common TypeScript/JavaScript extensions', () => {
    expect(FILE_EXTENSION_PATTERN.test('file.ts')).toBe(true);
    expect(FILE_EXTENSION_PATTERN.test('file.tsx')).toBe(true);
    expect(FILE_EXTENSION_PATTERN.test('file.js')).toBe(true);
    expect(FILE_EXTENSION_PATTERN.test('file.vue')).toBe(true);
    expect(FILE_EXTENSION_PATTERN.test('file.mjs')).toBe(true);
    expect(FILE_EXTENSION_PATTERN.test('file.cjs')).toBe(true);
  });

  it('does not match non-script extensions', () => {
    expect(FILE_EXTENSION_PATTERN.test('file.css')).toBe(false);
    expect(FILE_EXTENSION_PATTERN.test('file.json')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(FILE_EXTENSION_PATTERN.test('file.TS')).toBe(true);
    expect(FILE_EXTENSION_PATTERN.test('file.Vue')).toBe(true);
  });
});

describe('INDEX_FILE_PATTERN', () => {
  it('matches index files with supported extensions', () => {
    expect(INDEX_FILE_PATTERN.test('src/components/index.ts')).toBe(true);
    expect(INDEX_FILE_PATTERN.test('src/components/index.vue')).toBe(true);
  });

  it('captures the directory prefix', () => {
    const match = INDEX_FILE_PATTERN.exec('src/components/index.ts');
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('src/components');
  });

  it('does not match non-index files', () => {
    expect(INDEX_FILE_PATTERN.test('src/components/App.ts')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generatePathVariants
// ---------------------------------------------------------------------------

describe('generatePathVariants', () => {
  it('returns the path itself when no extension present', () => {
    const variants = generatePathVariants('src/utils');
    expect(variants).toContain('src/utils');
    expect(variants).toHaveLength(1);
  });

  it('returns both with and without extension for a .ts file', () => {
    const variants = generatePathVariants('src/utils/helpers.ts');
    expect(variants).toContain('src/utils/helpers.ts');
    expect(variants).toContain('src/utils/helpers');
  });

  it('includes directory variant for index files', () => {
    const variants = generatePathVariants('src/components/index.ts');
    expect(variants).toContain('src/components/index.ts');
    expect(variants).toContain('src/components/index');
    expect(variants).toContain('src/components');
  });

  it('deduplicates variants', () => {
    const variants = generatePathVariants('src/utils/helpers.ts');
    const unique = new Set(variants);
    expect(variants.length).toBe(unique.size);
  });
});

// ---------------------------------------------------------------------------
// getPackagePrefixFromImporter
// ---------------------------------------------------------------------------

describe('getPackagePrefixFromImporter', () => {
  it('extracts prefix before /src/ marker', () => {
    expect(getPackagePrefixFromImporter('packages/core/src/utils/helpers.ts')).toBe('packages/core');
  });

  it('returns undefined when no /src/ marker is found', () => {
    expect(getPackagePrefixFromImporter('lib/utils/helpers.ts')).toBeUndefined();
  });

  it('returns undefined when /src/ is at the start of the path', () => {
    // markerIndex would be 0 which is not > 0
    expect(getPackagePrefixFromImporter('src/utils/helpers.ts')).toBeUndefined();
  });

  it('normalizes path before extracting prefix', () => {
    expect(getPackagePrefixFromImporter('packages\\core\\src\\utils\\helpers.ts')).toBe('packages/core');
  });

  it('uses the first occurrence of /src/', () => {
    expect(getPackagePrefixFromImporter('packages/core/src/nested/src/file.ts')).toBe('packages/core');
  });
});

// ---------------------------------------------------------------------------
// expandCandidatePath
// ---------------------------------------------------------------------------

describe('expandCandidatePath', () => {
  it('returns only the input when it has an explicit extension', () => {
    const candidates = expandCandidatePath('src/utils/helpers.ts');
    expect(candidates).toEqual(['src/utils/helpers.ts']);
  });

  it('expands extensionless path with all extensions and index variants', () => {
    const candidates = expandCandidatePath('src/utils');
    expect(candidates).toContain('src/utils');
    for (const ext of EXTENSIONS) {
      expect(candidates).toContain(`src/utils${ext}`);
      expect(candidates).toContain(`src/utils/index${ext}`);
    }
    // original + 7 direct extensions + 7 index extensions = 15
    expect(candidates).toHaveLength(15);
  });

  it('normalizes the path', () => {
    const candidates = expandCandidatePath('src//utils');
    expect(candidates).toContain('src/utils');
  });
});

// ---------------------------------------------------------------------------
// resolveRelativeCandidates
// ---------------------------------------------------------------------------

describe('resolveRelativeCandidates', () => {
  it('resolves ./ imports relative to the importer directory', () => {
    const candidates = resolveRelativeCandidates('src/app.ts', './utils');
    expect(candidates).toContain('src/utils');
    expect(candidates).toContain('src/utils.ts');
    expect(candidates).toContain('src/utils/index.ts');
  });

  it('resolves ../ imports relative to the importer directory', () => {
    const candidates = resolveRelativeCandidates('src/components/Button.ts', '../utils');
    expect(candidates).toContain('src/utils');
    expect(candidates).toContain('src/utils.ts');
  });

  it('returns only the resolved path when import has explicit extension', () => {
    const candidates = resolveRelativeCandidates('src/app.ts', './utils.ts');
    expect(candidates).toEqual(['src/utils.ts']);
  });
});

// ---------------------------------------------------------------------------
// resolveNonRelativeCandidates
// ---------------------------------------------------------------------------

describe('resolveNonRelativeCandidates', () => {
  it('resolves @/ alias imports to src/ prefix', () => {
    const candidates = resolveNonRelativeCandidates('packages/core/src/app.ts', '@/utils/helpers');
    expect(candidates).toContain('src/utils/helpers');
    expect(candidates).toContain('src/utils/helpers.ts');
    // Also includes package-prefixed variants
    expect(candidates).toContain('packages/core/src/utils/helpers');
    expect(candidates).toContain('packages/core/src/utils/helpers.ts');
  });

  it('resolves src/ prefix imports', () => {
    const candidates = resolveNonRelativeCandidates('packages/core/src/app.ts', 'src/utils/helpers');
    expect(candidates).toContain('src/utils/helpers');
    expect(candidates).toContain('packages/core/src/utils/helpers');
  });

  it('returns empty array for bare module specifiers', () => {
    const candidates = resolveNonRelativeCandidates('src/app.ts', 'lodash');
    expect(candidates).toEqual([]);
  });

  it('returns empty array for scoped package specifiers', () => {
    const candidates = resolveNonRelativeCandidates('src/app.ts', '@vue/reactivity');
    // @vue/reactivity does not start with @/ (no slash after @vue)
    expect(candidates).toEqual([]);
  });

  it('handles @/ alias with explicit extension', () => {
    const candidates = resolveNonRelativeCandidates('packages/core/src/app.ts', '@/utils/helpers.ts');
    expect(candidates).toContain('src/utils/helpers.ts');
    expect(candidates).toContain('packages/core/src/utils/helpers.ts');
  });

  it('skips package prefix when importer has no /src/ marker', () => {
    const candidates = resolveNonRelativeCandidates('lib/app.ts', '@/utils/helpers');
    expect(candidates).toContain('src/utils/helpers');
    expect(candidates).toContain('src/utils/helpers.ts');
    // No package-prefixed variants because getPackagePrefixFromImporter returns undefined
    const hasPrefixed = candidates.some((c) => c.startsWith('lib/'));
    expect(hasPrefixed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildModulePathLookup
// ---------------------------------------------------------------------------

describe('buildModulePathLookup', () => {
  it('returns empty maps for a graph with no packages', () => {
    const lookup = buildModulePathLookup({ packages: [] });
    expect(lookup.packagePathMap.size).toBe(0);
    expect(lookup.globalPathMap.size).toBe(0);
  });

  it('returns empty path map for a package with no modules', () => {
    const graph: DependencyPackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'test',
          version: '1.0.0',
          path: '/test',
          created_at: '2024-01-01',
        },
      ],
    };
    const lookup = buildModulePathLookup(graph);
    expect(lookup.packagePathMap.has('pkg-1')).toBe(true);
    const pathMap = lookup.packagePathMap.get('pkg-1');
    expect(pathMap).toBeDefined();
    expect(pathMap?.size).toBe(0);
  });

  it('indexes modules by their relative path', () => {
    const graph = makeGraph({
      m1: { id: 'mod-1', name: 'helpers.ts', relativePath: 'src/utils/helpers.ts' },
    });
    const lookup = buildModulePathLookup(graph);
    const pathMap = lookup.packagePathMap.get('pkg-1');
    expect(pathMap).toBeDefined();
    expect(pathMap?.get('src/utils/helpers.ts')).toBe('mod-1');
    expect(pathMap?.get('src/utils/helpers')).toBe('mod-1');
  });

  it('indexes index files with directory shorthand', () => {
    const graph = makeGraph({
      m1: { id: 'mod-idx', name: 'index.ts', relativePath: 'src/components/index.ts' },
    });
    const lookup = buildModulePathLookup(graph);
    const pathMap = lookup.packagePathMap.get('pkg-1');
    expect(pathMap).toBeDefined();
    expect(pathMap?.get('src/components/index.ts')).toBe('mod-idx');
    expect(pathMap?.get('src/components/index')).toBe('mod-idx');
    expect(pathMap?.get('src/components')).toBe('mod-idx');
  });

  it('populates globalPathMap with module IDs', () => {
    const graph = makeGraph({
      m1: { id: 'mod-1', name: 'helpers.ts', relativePath: 'src/utils/helpers.ts' },
    });
    const lookup = buildModulePathLookup(graph);
    const globalEntry = lookup.globalPathMap.get('src/utils/helpers.ts');
    expect(globalEntry).toBeDefined();
    expect(globalEntry?.has('mod-1')).toBe(true);
  });

  it('globalPathMap contains multiple IDs when different packages share a path', () => {
    const graph: DependencyPackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'pkg-a',
          version: '1.0.0',
          path: '/a',
          created_at: '2024-01-01',
          modules: {
            m1: {
              id: 'mod-a',
              name: 'helpers.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/utils/helpers.ts' },
            },
          },
        },
        {
          id: 'pkg-2',
          name: 'pkg-b',
          version: '1.0.0',
          path: '/b',
          created_at: '2024-01-01',
          modules: {
            m2: {
              id: 'mod-b',
              name: 'helpers.ts',
              package_id: 'pkg-2',
              source: { relativePath: 'src/utils/helpers.ts' },
            },
          },
        },
      ],
    };
    const lookup = buildModulePathLookup(graph);
    const globalEntry = lookup.globalPathMap.get('src/utils/helpers.ts');
    expect(globalEntry).toBeDefined();
    expect(globalEntry?.size).toBe(2);
    expect(globalEntry?.has('mod-a')).toBe(true);
    expect(globalEntry?.has('mod-b')).toBe(true);
  });

  it('handles multiple modules in the same package', () => {
    const graph = makeGraph({
      m1: { id: 'mod-1', name: 'app.ts', relativePath: 'src/app.ts' },
      m2: { id: 'mod-2', name: 'utils.ts', relativePath: 'src/utils.ts' },
      m3: { id: 'mod-3', name: 'index.ts', relativePath: 'src/components/index.ts' },
    });
    const lookup = buildModulePathLookup(graph);
    const pathMap = lookup.packagePathMap.get('pkg-1');
    expect(pathMap).toBeDefined();
    expect(pathMap?.get('src/app.ts')).toBe('mod-1');
    expect(pathMap?.get('src/utils.ts')).toBe('mod-2');
    expect(pathMap?.get('src/components/index.ts')).toBe('mod-3');
    expect(pathMap?.get('src/components')).toBe('mod-3');
  });
});

// ---------------------------------------------------------------------------
// resolveModuleId
// ---------------------------------------------------------------------------

describe('resolveModuleId', () => {
  describe('with empty lookup', () => {
    it('returns undefined for any import', () => {
      const lookup = emptyLookup();
      expect(resolveModuleId(lookup, 'pkg-1', 'src/app.ts', './utils')).toBeUndefined();
    });
  });

  describe('relative imports', () => {
    it('resolves ./ import to a module in the same package', () => {
      const graph = makeGraph({
        m1: { id: 'mod-1', name: 'app.ts', relativePath: 'src/app.ts' },
        m2: { id: 'mod-2', name: 'utils.ts', relativePath: 'src/utils.ts' },
      });
      const lookup = buildModulePathLookup(graph);
      const result = resolveModuleId(lookup, 'pkg-1', 'src/app.ts', './utils');
      expect(result).toBe('mod-2');
    });

    it('resolves ../ import traversing up a directory', () => {
      const graph = makeGraph({
        m1: { id: 'mod-1', name: 'Button.ts', relativePath: 'src/components/Button.ts' },
        m2: { id: 'mod-2', name: 'helpers.ts', relativePath: 'src/utils/helpers.ts' },
      });
      const lookup = buildModulePathLookup(graph);
      const result = resolveModuleId(lookup, 'pkg-1', 'src/components/Button.ts', '../utils/helpers');
      expect(result).toBe('mod-2');
    });

    it('resolves directory import to index file', () => {
      const graph = makeGraph({
        m1: { id: 'mod-1', name: 'app.ts', relativePath: 'src/app.ts' },
        m2: { id: 'mod-idx', name: 'index.ts', relativePath: 'src/components/index.ts' },
      });
      const lookup = buildModulePathLookup(graph);
      const result = resolveModuleId(lookup, 'pkg-1', 'src/app.ts', './components');
      expect(result).toBe('mod-idx');
    });

    it('resolves import with explicit .ts extension', () => {
      const graph = makeGraph({
        m1: { id: 'mod-1', name: 'app.ts', relativePath: 'src/app.ts' },
        m2: { id: 'mod-2', name: 'utils.ts', relativePath: 'src/utils.ts' },
      });
      const lookup = buildModulePathLookup(graph);
      const result = resolveModuleId(lookup, 'pkg-1', 'src/app.ts', './utils.ts');
      expect(result).toBe('mod-2');
    });

    it('returns undefined when no matching module exists', () => {
      const graph = makeGraph({
        m1: { id: 'mod-1', name: 'app.ts', relativePath: 'src/app.ts' },
      });
      const lookup = buildModulePathLookup(graph);
      const result = resolveModuleId(lookup, 'pkg-1', 'src/app.ts', './nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('non-relative imports', () => {
    it('resolves @/ alias import', () => {
      const graph = makeGraph({
        m1: { id: 'mod-1', name: 'app.ts', relativePath: 'src/app.ts' },
        m2: { id: 'mod-2', name: 'helpers.ts', relativePath: 'src/utils/helpers.ts' },
      });
      const lookup = buildModulePathLookup(graph);
      const result = resolveModuleId(lookup, 'pkg-1', 'src/app.ts', '@/utils/helpers');
      expect(result).toBe('mod-2');
    });

    it('resolves src/ prefix import', () => {
      const graph = makeGraph({
        m1: { id: 'mod-1', name: 'app.ts', relativePath: 'src/app.ts' },
        m2: { id: 'mod-2', name: 'helpers.ts', relativePath: 'src/utils/helpers.ts' },
      });
      const lookup = buildModulePathLookup(graph);
      const result = resolveModuleId(lookup, 'pkg-1', 'src/app.ts', 'src/utils/helpers');
      expect(result).toBe('mod-2');
    });

    it('returns undefined for bare module specifiers (external)', () => {
      const graph = makeGraph({
        m1: { id: 'mod-1', name: 'app.ts', relativePath: 'src/app.ts' },
      });
      const lookup = buildModulePathLookup(graph);
      const result = resolveModuleId(lookup, 'pkg-1', 'src/app.ts', 'lodash');
      expect(result).toBeUndefined();
    });
  });

  describe('package-local vs global resolution', () => {
    it('prefers package-local match over global match', () => {
      const graph: DependencyPackageGraph = {
        packages: [
          {
            id: 'pkg-1',
            name: 'pkg-a',
            version: '1.0.0',
            path: '/a',
            created_at: '2024-01-01',
            modules: {
              m1: {
                id: 'mod-a-app',
                name: 'app.ts',
                package_id: 'pkg-1',
                source: { relativePath: 'src/app.ts' },
              },
              m2: {
                id: 'mod-a-utils',
                name: 'utils.ts',
                package_id: 'pkg-1',
                source: { relativePath: 'src/utils.ts' },
              },
            },
          },
          {
            id: 'pkg-2',
            name: 'pkg-b',
            version: '1.0.0',
            path: '/b',
            created_at: '2024-01-01',
            modules: {
              m3: {
                id: 'mod-b-utils',
                name: 'utils.ts',
                package_id: 'pkg-2',
                source: { relativePath: 'src/utils.ts' },
              },
            },
          },
        ],
      };
      const lookup = buildModulePathLookup(graph);
      const result = resolveModuleId(lookup, 'pkg-1', 'src/app.ts', './utils');
      expect(result).toBe('mod-a-utils');
    });

    it('falls back to global match when only one module matches globally', () => {
      const graph: DependencyPackageGraph = {
        packages: [
          {
            id: 'pkg-1',
            name: 'pkg-a',
            version: '1.0.0',
            path: '/a',
            created_at: '2024-01-01',
            modules: {
              m1: {
                id: 'mod-a-app',
                name: 'app.ts',
                package_id: 'pkg-1',
                source: { relativePath: 'src/app.ts' },
              },
            },
          },
          {
            id: 'pkg-2',
            name: 'pkg-b',
            version: '1.0.0',
            path: '/b',
            created_at: '2024-01-01',
            modules: {
              m2: {
                id: 'mod-b-utils',
                name: 'utils.ts',
                package_id: 'pkg-2',
                source: { relativePath: 'src/utils.ts' },
              },
            },
          },
        ],
      };
      const lookup = buildModulePathLookup(graph);
      // pkg-1 has no src/utils.ts, but pkg-2 does; global lookup has exactly 1 match
      const result = resolveModuleId(lookup, 'pkg-1', 'src/app.ts', './utils');
      expect(result).toBe('mod-b-utils');
    });

    it('returns undefined when multiple global matches exist (ambiguous)', () => {
      const graph: DependencyPackageGraph = {
        packages: [
          {
            id: 'pkg-1',
            name: 'pkg-a',
            version: '1.0.0',
            path: '/a',
            created_at: '2024-01-01',
            modules: {
              m1: {
                id: 'mod-a-app',
                name: 'app.ts',
                package_id: 'pkg-1',
                source: { relativePath: 'src/app.ts' },
              },
            },
          },
          {
            id: 'pkg-2',
            name: 'pkg-b',
            version: '1.0.0',
            path: '/b',
            created_at: '2024-01-01',
            modules: {
              m2: {
                id: 'mod-b-utils',
                name: 'utils.ts',
                package_id: 'pkg-2',
                source: { relativePath: 'src/utils.ts' },
              },
            },
          },
          {
            id: 'pkg-3',
            name: 'pkg-c',
            version: '1.0.0',
            path: '/c',
            created_at: '2024-01-01',
            modules: {
              m3: {
                id: 'mod-c-utils',
                name: 'utils.ts',
                package_id: 'pkg-3',
                source: { relativePath: 'src/utils.ts' },
              },
            },
          },
        ],
      };
      const lookup = buildModulePathLookup(graph);
      // pkg-1 has no src/utils.ts, global has 2 matches => ambiguous => undefined
      const result = resolveModuleId(lookup, 'pkg-1', 'src/app.ts', './utils');
      expect(result).toBeUndefined();
    });
  });

  describe('with unknown packageId', () => {
    it('still checks the global path map', () => {
      const graph = makeGraph({
        m1: { id: 'mod-1', name: 'utils.ts', relativePath: 'src/utils.ts' },
      });
      const lookup = buildModulePathLookup(graph);
      const result = resolveModuleId(lookup, 'unknown-pkg', 'src/app.ts', './utils');
      expect(result).toBe('mod-1');
    });
  });
});
