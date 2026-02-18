/**
 * Tests for TypeCollection<T> type and its associated utility functions.
 *
 * The TypeCollection type is defined in src/shared/types/TypeCollection.ts
 * and represents a union of Map<string, T> | Record<string, T> | T[].
 *
 * The utility functions that operate on TypeCollection live in
 * src/client/utils/collections.ts: typeCollectionToArray() and mapTypeCollection().
 */
import { mapTypeCollection, typeCollectionToArray } from '../../../client/utils/collections';
import type { TypeCollection } from '../TypeCollection';

describe('typeCollectionToArray', () => {
  describe('with undefined input', () => {
    it('returns an empty array for undefined', () => {
      expect(typeCollectionToArray(undefined)).toEqual([]);
    });

    it('returns an empty array (not undefined or null)', () => {
      const result = typeCollectionToArray(undefined);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('with Array input', () => {
    it('returns the exact same array reference (no copy)', () => {
      const arr = [1, 2, 3];
      expect(typeCollectionToArray(arr)).toBe(arr);
    });

    it('returns an empty array as-is', () => {
      const arr: string[] = [];
      expect(typeCollectionToArray(arr)).toBe(arr);
      expect(typeCollectionToArray(arr)).toHaveLength(0);
    });

    it('handles arrays with mixed falsy values', () => {
      const arr = [0, '', false, null];
      expect(typeCollectionToArray(arr)).toEqual([0, '', false, null]);
    });

    it('handles nested arrays', () => {
      const arr = [[1, 2], [3, 4], [5]];
      expect(typeCollectionToArray(arr)).toEqual([[1, 2], [3, 4], [5]]);
    });
  });

  describe('with Map input', () => {
    it('extracts values into an array', () => {
      const map = new Map<string, number>([
        ['a', 10],
        ['b', 20],
        ['c', 30],
      ]);
      expect(typeCollectionToArray(map)).toEqual([10, 20, 30]);
    });

    it('returns an empty array for an empty Map', () => {
      const map = new Map<string, string>();
      const result = typeCollectionToArray(map);
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('preserves insertion order of Map entries', () => {
      const map = new Map<string, string>();
      map.set('z', 'last-inserted-first');
      map.set('a', 'second');
      map.set('m', 'third');
      expect(typeCollectionToArray(map)).toEqual(['last-inserted-first', 'second', 'third']);
    });

    it('handles Map values that are null or undefined', () => {
      const map = new Map<string, string | null | undefined>([
        ['a', null],
        ['b', undefined],
        ['c', 'valid'],
      ]);
      expect(typeCollectionToArray(map)).toEqual([null, undefined, 'valid']);
    });
  });

  describe('with Record input', () => {
    it('extracts values into an array', () => {
      const record: Record<string, number> = { x: 100, y: 200 };
      expect(typeCollectionToArray(record)).toEqual([100, 200]);
    });

    it('returns an empty array for an empty Record', () => {
      const record: Record<string, number> = {};
      expect(typeCollectionToArray(record)).toEqual([]);
    });

    it('handles Record with null values', () => {
      const record: Record<string, string | null> = { a: null, b: 'valid', c: null };
      expect(typeCollectionToArray(record)).toEqual([null, 'valid', null]);
    });

    it('handles Record with complex object values', () => {
      const record: Record<string, { id: number; name: string }> = {
        first: { id: 1, name: 'Alice' },
        second: { id: 2, name: 'Bob' },
      };
      const result = typeCollectionToArray(record);
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);
    });
  });

  describe('type safety at runtime', () => {
    it('correctly identifies Array over Record-like arrays', () => {
      // An array is also an object, but Array.isArray should match first
      const arr = ['a', 'b', 'c'];
      const result = typeCollectionToArray(arr);
      // Should return the same reference (array path), not Object.values
      expect(result).toBe(arr);
    });

    it('correctly identifies Map instances', () => {
      const map = new Map([['key', 'value']]);
      const result = typeCollectionToArray(map);
      expect(result).toEqual(['value']);
      // Should NOT be the same reference since Map values are extracted
      expect(result).not.toBe(map);
    });
  });
});

describe('mapTypeCollection', () => {
  const double = (n: number): number => n * 2;
  const toString = (n: number): string => `#${n}`;

  describe('with Array input', () => {
    it('maps over array elements', () => {
      expect(mapTypeCollection([1, 2, 3], double)).toEqual([2, 4, 6]);
    });

    it('handles empty array', () => {
      expect(mapTypeCollection([] as number[], double)).toEqual([]);
    });

    it('supports type-changing mapper', () => {
      expect(mapTypeCollection([10, 20], toString)).toEqual(['#10', '#20']);
    });

    it('mapper receives only the item value', () => {
      const received: number[] = [];
      mapTypeCollection([5, 10, 15], (item) => {
        received.push(item);
        return item;
      });
      expect(received).toEqual([5, 10, 15]);
    });
  });

  describe('with Map input', () => {
    it('maps over Map values and ignores keys', () => {
      const map = new Map<string, number>([
        ['x', 3],
        ['y', 7],
      ]);
      expect(mapTypeCollection(map, double)).toEqual([6, 14]);
    });

    it('handles empty Map', () => {
      const map = new Map<string, number>();
      expect(mapTypeCollection(map, double)).toEqual([]);
    });

    it('preserves Map insertion order in output', () => {
      const map = new Map<string, number>();
      map.set('c', 30);
      map.set('a', 10);
      map.set('b', 20);
      expect(mapTypeCollection(map, double)).toEqual([60, 20, 40]);
    });

    it('supports type-changing mapper on Map', () => {
      const map = new Map<string, number>([['item', 42]]);
      expect(mapTypeCollection(map, toString)).toEqual(['#42']);
    });
  });

  describe('with Record input', () => {
    it('maps over Record values', () => {
      const record: Record<string, number> = { a: 1, b: 2 };
      expect(mapTypeCollection(record, double)).toEqual([2, 4]);
    });

    it('handles empty Record', () => {
      const record: Record<string, number> = {};
      expect(mapTypeCollection(record, double)).toEqual([]);
    });

    it('supports type-changing mapper on Record', () => {
      const record: Record<string, number> = { val: 99 };
      expect(mapTypeCollection(record, toString)).toEqual(['#99']);
    });
  });

  describe('mapper edge cases', () => {
    it('handles mapper that returns undefined', () => {
      const result = mapTypeCollection([1, 2, 3], () => undefined);
      expect(result).toEqual([undefined, undefined, undefined]);
      expect(result).toHaveLength(3);
    });

    it('handles mapper that returns null', () => {
      const result = mapTypeCollection([1, 2], () => null);
      expect(result).toEqual([null, null]);
    });

    it('handles mapper that returns objects', () => {
      const result = mapTypeCollection([1, 2], (n) => ({ value: n, doubled: n * 2 }));
      expect(result).toEqual([
        { value: 1, doubled: 2 },
        { value: 2, doubled: 4 },
      ]);
    });

    it('handles mapper that returns arrays', () => {
      const result = mapTypeCollection([1, 2], (n) => [n, n * 2]);
      expect(result).toEqual([[1, 2], [2, 4]]);
    });
  });

  describe('always returns a new array', () => {
    it('returns a new array for Array input (not the same reference)', () => {
      const input = [1, 2, 3];
      const result = mapTypeCollection(input, double);
      expect(result).not.toBe(input);
      expect(result).toEqual([2, 4, 6]);
    });

    it('returns an array for Map input', () => {
      const map = new Map([['k', 1]]);
      const result = mapTypeCollection(map, double);
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns an array for Record input', () => {
      const record = { k: 1 };
      const result = mapTypeCollection(record, double);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

describe('TypeCollection type compatibility', () => {
  it('accepts an array as TypeCollection', () => {
    const collection: TypeCollection<number> = [1, 2, 3];
    expect(typeCollectionToArray(collection)).toEqual([1, 2, 3]);
  });

  it('accepts a Map as TypeCollection', () => {
    const collection: TypeCollection<string> = new Map([['a', 'hello']]);
    expect(typeCollectionToArray(collection)).toEqual(['hello']);
  });

  it('accepts a Record as TypeCollection', () => {
    const collection: TypeCollection<boolean> = { active: true, deleted: false };
    expect(typeCollectionToArray(collection)).toEqual([true, false]);
  });

  it('works with complex generic types', () => {
    interface Item {
      id: number;
      label: string;
    }
    const items: TypeCollection<Item> = [
      { id: 1, label: 'first' },
      { id: 2, label: 'second' },
    ];
    const labels = mapTypeCollection(items, (item) => item.label);
    expect(labels).toEqual(['first', 'second']);
  });
});
