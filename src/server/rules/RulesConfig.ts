export interface RulesConfig {
  typeUnionWithoutAlias: {
    memberThreshold: number;
  };
}

export const defaultRulesConfig: RulesConfig = {
  typeUnionWithoutAlias: {
    memberThreshold: 3,
  },
};
