import { defaultRulesConfig } from '../RulesConfig';

// ---------------------------------------------------------------------------
// RulesConfig interface shape
// ---------------------------------------------------------------------------
describe('RulesConfig', () => {
  describe('defaultRulesConfig', () => {
    it('is defined and non-null', () => {
      expect(defaultRulesConfig).toBeDefined();
      expect(defaultRulesConfig).not.toBeNull();
    });

    it('has typeUnionWithoutAlias section', () => {
      expect(defaultRulesConfig).toHaveProperty('typeUnionWithoutAlias');
    });

    it('has memberThreshold as a number', () => {
      expect(typeof defaultRulesConfig.typeUnionWithoutAlias.memberThreshold).toBe('number');
    });

    it('defaults memberThreshold to 3', () => {
      expect(defaultRulesConfig.typeUnionWithoutAlias.memberThreshold).toBe(3);
    });

    it('memberThreshold is a positive integer', () => {
      expect(defaultRulesConfig.typeUnionWithoutAlias.memberThreshold).toBeGreaterThan(0);
      expect(Number.isInteger(defaultRulesConfig.typeUnionWithoutAlias.memberThreshold)).toBe(true);
    });
  });
});
