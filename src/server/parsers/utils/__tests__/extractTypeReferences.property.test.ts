import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { extractTypeNames } from '../extractTypeReferences';

describe('extractTypeNames property tests', () => {
  it('always returns unique, capitalized identifiers', () => {
    fc.assert(
      fc.property(fc.string(), (source) => {
        const names = extractTypeNames(source);
        const uniqueNames = new Set(names);

        expect(uniqueNames.size).toBe(names.length);
        names.forEach((name) => {
          expect(/^[A-Z][A-Za-z0-9]*$/.test(name)).toBe(true);
        });
      }),
      { numRuns: 200 }
    );
  });

  it('returns no references for lowercase-only identifier streams', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{1,12}$/), { minLength: 1, maxLength: 40 }),
        (words) => {
          const source = words.join(' | ');
          const names = extractTypeNames(source);
          expect(names).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
