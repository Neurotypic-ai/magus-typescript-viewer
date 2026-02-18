import { mapTypeCollection, typeCollectionToArray } from '../collections';

describe('mapTypeCollection', () => {
  const double = (n: number) => n * 2;
  const toUpperCase = (s: string) => s.toUpperCase();

  describe('with Array input', () => {
    it('maps over an array', () => {
      expect(mapTypeCollection([1, 2, 3], double)).toEqual([2, 4, 6]);
    });

    it('handles an empty array', () => {
      expect(mapTypeCollection([] as number[], double)).toEqual([]);
    });

    it('handles a single-element array', () => {
      expect(mapTypeCollection([5], double)).toEqual([10]);
    });

    it('applies a string mapper', () => {
      expect(mapTypeCollection(['hello', 'world'], toUpperCase)).toEqual(['HELLO', 'WORLD']);
    });
  });

  describe('with Map input', () => {
    it('maps over Map values', () => {
      const map = new Map<string, number>([
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ]);
      expect(mapTypeCollection(map, double)).toEqual([2, 4, 6]);
    });

    it('handles an empty Map', () => {
      const map = new Map<string, number>();
      expect(mapTypeCollection(map, double)).toEqual([]);
    });

    it('handles a single-entry Map', () => {
      const map = new Map<string, number>([['x', 10]]);
      expect(mapTypeCollection(map, double)).toEqual([20]);
    });

    it('ignores Map keys, uses only values', () => {
      const map = new Map<string, string>([
        ['key1', 'alpha'],
        ['key2', 'beta'],
      ]);
      expect(mapTypeCollection(map, toUpperCase)).toEqual(['ALPHA', 'BETA']);
    });
  });

  describe('with Record input', () => {
    it('maps over Record values', () => {
      const record: Record<string, number> = { a: 1, b: 2, c: 3 };
      expect(mapTypeCollection(record, double)).toEqual([2, 4, 6]);
    });

    it('handles an empty Record', () => {
      const record: Record<string, number> = {};
      expect(mapTypeCollection(record, double)).toEqual([]);
    });

    it('handles a single-property Record', () => {
      const record: Record<string, number> = { only: 7 };
      expect(mapTypeCollection(record, double)).toEqual([14]);
    });

    it('applies a string mapper to Record values', () => {
      const record: Record<string, string> = { greeting: 'hi', farewell: 'bye' };
      expect(mapTypeCollection(record, toUpperCase)).toEqual(['HI', 'BYE']);
    });
  });

  describe('mapper transformations', () => {
    it('supports type-changing mappers (number to string)', () => {
      const result = mapTypeCollection([1, 2, 3], (n) => `item-${n}`);
      expect(result).toEqual(['item-1', 'item-2', 'item-3']);
    });

    it('supports type-changing mappers (string to boolean)', () => {
      const result = mapTypeCollection(['', 'a', '', 'bc'], (s) => s.length > 0);
      expect(result).toEqual([false, true, false, true]);
    });

    it('supports mapping to objects', () => {
      const result = mapTypeCollection([1, 2], (n) => ({ value: n }));
      expect(result).toEqual([{ value: 1 }, { value: 2 }]);
    });
  });
});

describe('typeCollectionToArray', () => {
  describe('with undefined input', () => {
    it('returns an empty array for undefined', () => {
      expect(typeCollectionToArray(undefined)).toEqual([]);
    });
  });

  describe('with Array input', () => {
    it('returns the same array reference', () => {
      const arr = [1, 2, 3];
      const result = typeCollectionToArray(arr);
      expect(result).toBe(arr);
    });

    it('returns an empty array as-is', () => {
      const arr: number[] = [];
      expect(typeCollectionToArray(arr)).toBe(arr);
    });

    it('handles a single-element array', () => {
      expect(typeCollectionToArray([42])).toEqual([42]);
    });

    it('handles arrays with duplicate values', () => {
      expect(typeCollectionToArray([1, 1, 2, 2, 3])).toEqual([1, 1, 2, 2, 3]);
    });
  });

  describe('with Map input', () => {
    it('extracts values into an array', () => {
      const map = new Map<string, number>([
        ['a', 10],
        ['b', 20],
      ]);
      expect(typeCollectionToArray(map)).toEqual([10, 20]);
    });

    it('returns an empty array for an empty Map', () => {
      const map = new Map<string, number>();
      expect(typeCollectionToArray(map)).toEqual([]);
    });

    it('handles a Map with a single entry', () => {
      const map = new Map<string, string>([['key', 'value']]);
      expect(typeCollectionToArray(map)).toEqual(['value']);
    });

    it('handles a Map with duplicate values', () => {
      const map = new Map<string, number>([
        ['a', 1],
        ['b', 1],
        ['c', 2],
      ]);
      expect(typeCollectionToArray(map)).toEqual([1, 1, 2]);
    });
  });

  describe('with Record input', () => {
    it('extracts values into an array', () => {
      const record: Record<string, number> = { x: 5, y: 10 };
      expect(typeCollectionToArray(record)).toEqual([5, 10]);
    });

    it('returns an empty array for an empty Record', () => {
      const record: Record<string, number> = {};
      expect(typeCollectionToArray(record)).toEqual([]);
    });

    it('handles a Record with a single property', () => {
      const record: Record<string, string> = { only: 'one' };
      expect(typeCollectionToArray(record)).toEqual(['one']);
    });

    it('handles a Record with duplicate values', () => {
      const record: Record<string, number> = { a: 1, b: 1, c: 2 };
      expect(typeCollectionToArray(record)).toEqual([1, 1, 2]);
    });
  });

  describe('with object values', () => {
    it('handles collections of objects', () => {
      const items = [{ id: 1 }, { id: 2 }];
      expect(typeCollectionToArray(items)).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('handles a Map of objects', () => {
      const map = new Map<string, { name: string }>([
        ['a', { name: 'Alice' }],
        ['b', { name: 'Bob' }],
      ]);
      expect(typeCollectionToArray(map)).toEqual([{ name: 'Alice' }, { name: 'Bob' }]);
    });

    it('handles a Record of objects', () => {
      const record: Record<string, { active: boolean }> = {
        user1: { active: true },
        user2: { active: false },
      };
      expect(typeCollectionToArray(record)).toEqual([{ active: true }, { active: false }]);
    });
  });
});
