import { simpleHash } from '../hash';

describe('simpleHash', () => {
  describe('determinism', () => {
    it('returns the same hash for the same input across multiple calls', () => {
      const input = 'hello world';
      const first = simpleHash(input);
      const second = simpleHash(input);
      const third = simpleHash(input);

      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it('returns the same hash for identical multi-line strings', () => {
      const input = 'line one\nline two\nline three';
      expect(simpleHash(input)).toBe(simpleHash(input));
    });
  });

  describe('return type and range', () => {
    it('returns a non-negative integer', () => {
      const inputs = ['a', 'test', 'hello world', '', '!@#$%'];
      for (const input of inputs) {
        const result = simpleHash(input);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(result)).toBe(true);
      }
    });

    it('returns a value within unsigned 32-bit integer range', () => {
      const inputs = ['a', 'zzzzzz', 'Hello, World!', '\u{1F600}'];
      for (const input of inputs) {
        const result = simpleHash(input);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(0xffffffff);
      }
    });
  });

  describe('collision resistance', () => {
    it('produces different hashes for different single-character inputs', () => {
      const hashes = new Set<number>();
      for (let i = 32; i < 127; i++) {
        hashes.add(simpleHash(String.fromCharCode(i)));
      }
      // All 95 printable ASCII characters should produce unique hashes
      expect(hashes.size).toBe(95);
    });

    it('produces different hashes for similar but distinct strings', () => {
      const a = simpleHash('abc');
      const b = simpleHash('abd');
      const c = simpleHash('bbc');
      expect(a).not.toBe(b);
      expect(a).not.toBe(c);
      expect(b).not.toBe(c);
    });

    it('produces different hashes for strings that differ only by order', () => {
      expect(simpleHash('ab')).not.toBe(simpleHash('ba'));
      expect(simpleHash('abc')).not.toBe(simpleHash('cba'));
    });

    it('produces different hashes for strings that differ only by case', () => {
      expect(simpleHash('Hello')).not.toBe(simpleHash('hello'));
      expect(simpleHash('ABC')).not.toBe(simpleHash('abc'));
    });

    it('produces different hashes for strings that differ only by whitespace', () => {
      expect(simpleHash('a b')).not.toBe(simpleHash('ab'));
      expect(simpleHash('a b')).not.toBe(simpleHash('a  b'));
    });

    it('produces different hashes for a set of common words', () => {
      const words = ['class', 'interface', 'function', 'module', 'export', 'import', 'type', 'enum'];
      const hashes = words.map((w) => simpleHash(w));
      const unique = new Set(hashes);
      expect(unique.size).toBe(words.length);
    });
  });

  describe('edge cases', () => {
    it('returns 0 for an empty string', () => {
      expect(simpleHash('')).toBe(0);
    });

    it('handles a very long string without throwing', () => {
      const longString = 'a'.repeat(100_000);
      expect(() => simpleHash(longString)).not.toThrow();
      const result = simpleHash(longString);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(result)).toBe(true);
    });

    it('returns a deterministic hash for a very long string', () => {
      const longString = 'x'.repeat(50_000);
      expect(simpleHash(longString)).toBe(simpleHash(longString));
    });

    it('handles special characters', () => {
      const specials = ['!@#$%^&*()', '<script>alert("xss")</script>', '  \t\n\r  ', '\0\0\0'];
      for (const s of specials) {
        const result = simpleHash(s);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(result)).toBe(true);
      }
    });

    it('handles unicode characters', () => {
      const result = simpleHash('\u00e9\u00e8\u00ea'); // accented e variants
      expect(result).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(result)).toBe(true);
    });

    it('handles emoji characters', () => {
      const result = simpleHash('\u{1F600}\u{1F601}\u{1F602}');
      expect(result).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(result)).toBe(true);
    });

    it('handles a string of only spaces', () => {
      const result = simpleHash('     ');
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).not.toBe(0); // spaces have non-zero char codes
    });

    it('handles a single character', () => {
      // 'a' has charCode 97; the hash should be exactly 97 for a single char
      // hash = ((0 << 5) - 0 + 97) | 0 = 97; 97 >>> 0 = 97
      expect(simpleHash('a')).toBe(97);
    });
  });

  describe('known value regression', () => {
    it('produces stable known values that do not change across versions', () => {
      // Pin a few values so refactors that accidentally change the algorithm are caught
      expect(simpleHash('a')).toBe(97);
      expect(simpleHash('ab')).toBe(3105);
      expect(simpleHash('abc')).toBe(96354);
      expect(simpleHash('hello')).toBe(99162322);
    });
  });
});
