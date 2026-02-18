import { defaultRulesConfig } from '../RulesConfig';

import type { RulesConfig } from '../RulesConfig';

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

  describe('type compatibility', () => {
    it('accepts a valid complete RulesConfig object', () => {
      const config: RulesConfig = {
        typeUnionWithoutAlias: {
          memberThreshold: 5,
        },
      };
      expect(config.typeUnionWithoutAlias.memberThreshold).toBe(5);
    });

    it('allows overriding defaults via spread', () => {
      const custom: RulesConfig = {
        ...defaultRulesConfig,
        typeUnionWithoutAlias: {
          ...defaultRulesConfig.typeUnionWithoutAlias,
          memberThreshold: 10,
        },
      };
      expect(custom.typeUnionWithoutAlias.memberThreshold).toBe(10);
    });

    it('spread without overrides preserves defaults', () => {
      const config: RulesConfig = { ...defaultRulesConfig };
      expect(config).toEqual(defaultRulesConfig);
    });

    it('partial override merges correctly with defaults', () => {
      const partial: Partial<RulesConfig> = {
        typeUnionWithoutAlias: { memberThreshold: 7 },
      };
      const merged: RulesConfig = { ...defaultRulesConfig, ...partial };
      expect(merged.typeUnionWithoutAlias.memberThreshold).toBe(7);
    });

    it('empty partial preserves all defaults', () => {
      const partial: Partial<RulesConfig> = {};
      const merged: RulesConfig = { ...defaultRulesConfig, ...partial };
      expect(merged).toEqual(defaultRulesConfig);
    });
  });
});
