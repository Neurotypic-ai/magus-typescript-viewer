import { describe, it, expect } from 'vitest';

import { toSarif, severityToLevel } from '../sarif-output';

import type { InsightReport } from '../types';
import type { SarifLog } from '../sarif-output';

function emptyReport(): InsightReport {
  return {
    computedAt: '2026-01-01T00:00:00.000Z',
    healthScore: 100,
    summary: { critical: 0, warning: 0, info: 0 },
    insights: [],
  };
}

describe('toSarif', () => {
  it('produces valid SARIF structure for empty report', () => {
    const sarif = toSarif(emptyReport());

    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toBe(
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json'
    );
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe('magus-typescript-viewer');
    expect(sarif.runs[0].tool.driver.rules).toEqual([]);
    expect(sarif.runs[0].results).toEqual([]);
  });

  it('maps severity levels correctly', () => {
    expect(severityToLevel('critical')).toBe('error');
    expect(severityToLevel('warning')).toBe('warning');
    expect(severityToLevel('info')).toBe('note');
  });

  it('creates a rule and result for each insight', () => {
    const report = emptyReport();
    report.insights = [
      {
        type: 'god-class',
        category: 'structural-complexity',
        severity: 'critical',
        title: 'God class detected',
        description: 'Classes with too many methods',
        entities: [
          { id: '1', kind: 'class', name: 'BigService' },
          { id: '2', kind: 'class', name: 'MegaController' },
        ],
        value: 50,
        threshold: 20,
      },
    ];
    report.summary.critical = 1;

    const sarif = toSarif(report);
    const run = sarif.runs[0];

    // One unique rule for the InsightKind
    expect(run.tool.driver.rules).toHaveLength(1);
    expect(run.tool.driver.rules[0].id).toBe('god-class');
    expect(run.tool.driver.rules[0].defaultConfiguration.level).toBe('error');

    // One result per entity
    expect(run.results).toHaveLength(2);
    expect(run.results[0].ruleId).toBe('god-class');
    expect(run.results[0].level).toBe('error');
    expect(run.results[0].message.text).toContain('BigService');
    expect(run.results[1].message.text).toContain('MegaController');
  });

  it('deduplicates rules when multiple insights share the same InsightKind', () => {
    const report = emptyReport();
    report.insights = [
      {
        type: 'import-fan-out',
        category: 'dependency-health',
        severity: 'warning',
        title: 'High fan-out',
        description: 'Module imports too many dependencies',
        entities: [{ id: '1', kind: 'module', name: 'index.ts' }],
      },
      {
        type: 'import-fan-out',
        category: 'dependency-health',
        severity: 'warning',
        title: 'High fan-out',
        description: 'Module imports too many dependencies',
        entities: [{ id: '2', kind: 'module', name: 'app.ts' }],
      },
    ];

    const sarif = toSarif(report);

    expect(sarif.runs[0].tool.driver.rules).toHaveLength(1);
    expect(sarif.runs[0].results).toHaveLength(2);
  });

  it('handles insight with no entities', () => {
    const report = emptyReport();
    report.insights = [
      {
        type: 'orphaned-modules',
        category: 'connectivity',
        severity: 'info',
        title: 'No orphaned modules',
        description: 'All modules are connected',
        entities: [],
      },
    ];

    const sarif = toSarif(report);
    const run = sarif.runs[0];

    expect(run.results).toHaveLength(1);
    expect(run.results[0].level).toBe('note');
    expect(run.results[0].message.text).toBe('All modules are connected');
    expect(run.results[0].locations).toEqual([]);
  });

  it('includes entity detail in result message when present', () => {
    const report = emptyReport();
    report.insights = [
      {
        type: 'long-parameter-lists',
        category: 'structural-complexity',
        severity: 'warning',
        title: 'Long parameter list',
        description: 'Functions with too many parameters',
        entities: [
          { id: '1', kind: 'function', name: 'processData', detail: '12 parameters' },
        ],
      },
    ];

    const sarif = toSarif(report);
    const result = sarif.runs[0].results[0];

    expect(result.message.text).toContain('processData');
    expect(result.message.text).toContain('12 parameters');
  });

  it('returns correct schema and version fields', () => {
    const sarif: SarifLog = toSarif(emptyReport());

    // Verify exact values required by SARIF spec
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toMatch(/sarif-schema-2\.1\.0\.json$/);
  });
});
