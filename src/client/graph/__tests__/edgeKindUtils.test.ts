import { toDependencyEdgeKind } from '../edgeKindUtils';

describe('edgeKindUtils', () => {
  describe('toDependencyEdgeKind', () => {
    it('returns the same kind for each valid edge kind', () => {
      const validKinds = [
        'dependency',
        'devDependency',
        'peerDependency',
        'import',
        'export',
        'inheritance',
        'implements',
        'extends',
        'contains',
        'uses',
      ] as const;

      for (const kind of validKinds) {
        expect(toDependencyEdgeKind(kind)).toBe(kind);
      }
    });

    it('returns "dependency" for undefined input', () => {
      expect(toDependencyEdgeKind(undefined)).toBe('dependency');
    });

    it('returns "dependency" for unknown edge kind strings', () => {
      expect(toDependencyEdgeKind('unknown')).toBe('dependency');
      expect(toDependencyEdgeKind('foo')).toBe('dependency');
      expect(toDependencyEdgeKind('DEPENDENCY')).toBe('dependency');
      expect(toDependencyEdgeKind('Dependency')).toBe('dependency');
    });

    it('returns "dependency" for empty string', () => {
      expect(toDependencyEdgeKind('')).toBe('dependency');
    });

    it('is case-sensitive', () => {
      expect(toDependencyEdgeKind('Import')).toBe('dependency');
      expect(toDependencyEdgeKind('IMPORT')).toBe('dependency');
      expect(toDependencyEdgeKind('DevDependency')).toBe('dependency');
      expect(toDependencyEdgeKind('DEVDEPENDENCY')).toBe('dependency');
    });

    it('does not match strings with extra whitespace', () => {
      expect(toDependencyEdgeKind(' dependency')).toBe('dependency');
      expect(toDependencyEdgeKind('dependency ')).toBe('dependency');
      expect(toDependencyEdgeKind(' dependency ')).toBe('dependency');
    });

    it('does not match substrings of valid kinds', () => {
      expect(toDependencyEdgeKind('depend')).toBe('dependency');
      expect(toDependencyEdgeKind('imp')).toBe('dependency');
      expect(toDependencyEdgeKind('ext')).toBe('dependency');
    });

    it('does not match strings containing valid kinds with extra characters', () => {
      expect(toDependencyEdgeKind('dependency!')).toBe('dependency');
      expect(toDependencyEdgeKind('pre-import')).toBe('dependency');
      expect(toDependencyEdgeKind('extends2')).toBe('dependency');
    });
  });
});
