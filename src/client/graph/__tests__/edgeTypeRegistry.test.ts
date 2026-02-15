import { describe, expect, it } from 'vitest';

import {
  getHandleCategory,
  isValidEdgeConnection,
} from '../edgeTypeRegistry';

describe('edgeTypeRegistry', () => {
  it('validates documented and invalid edge connections', () => {
    expect(isValidEdgeConnection('import', 'module', 'module')).toBe(true);
    expect(isValidEdgeConnection('implements', 'class', 'interface')).toBe(true);
    expect(isValidEdgeConnection('implements', 'module', 'module')).toBe(true);
    expect(isValidEdgeConnection('inheritance', 'module', 'module')).toBe(true);
    expect(isValidEdgeConnection('uses', 'class', 'property')).toBe(true);

    expect(isValidEdgeConnection('import', 'class', 'module')).toBe(false);
    expect(isValidEdgeConnection('implements', 'interface', 'class')).toBe(false);
    expect(isValidEdgeConnection('dependency', 'module', 'module')).toBe(false);
  });

  it('returns expected handle categories', () => {
    expect(getHandleCategory('contains')).toBe('structural');
    expect(getHandleCategory('import')).toBe('relational');
    expect(getHandleCategory('uses')).toBe('relational');
  });
});

