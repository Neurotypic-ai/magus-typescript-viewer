import type { InsightKind, InsightReport, InsightResult, InsightSeverity } from './types';

// ── SARIF 2.1.0 types (subset) ──────────────────────────────────────────────

export interface SarifLog {
  version: '2.1.0';
  $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json';
  runs: SarifRun[];
}

export interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      rules: SarifRule[];
    };
  };
  results: SarifResult[];
}

export interface SarifRule {
  id: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: SarifLevel };
}

export interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: { text: string };
  locations: SarifLocation[];
}

export interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
  };
}

export type SarifLevel = 'error' | 'warning' | 'note';

// ── Mapping helpers ─────────────────────────────────────────────────────────

const SEVERITY_TO_LEVEL: Record<InsightSeverity, SarifLevel> = {
  critical: 'error',
  warning: 'warning',
  info: 'note',
};

export function severityToLevel(severity: InsightSeverity): SarifLevel {
  return SEVERITY_TO_LEVEL[severity];
}

function insightToRule(insight: InsightResult): SarifRule {
  return {
    id: insight.type,
    shortDescription: { text: insight.title },
    defaultConfiguration: { level: severityToLevel(insight.severity) },
  };
}

function insightToResults(insight: InsightResult): SarifResult[] {
  // If there are entities, produce one result per entity for precise locations
  if (insight.entities.length > 0) {
    return insight.entities.map((entity) => ({
      ruleId: insight.type,
      level: severityToLevel(insight.severity),
      message: { text: `${insight.title}: ${entity.name}${entity.detail ? ` — ${entity.detail}` : ''}` },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: entity.name },
          },
        },
      ],
    }));
  }

  // No entities — produce a single result with the description
  return [
    {
      ruleId: insight.type,
      level: severityToLevel(insight.severity),
      message: { text: insight.description },
      locations: [],
    },
  ];
}

// ── Main conversion ─────────────────────────────────────────────────────────

export function toSarif(report: InsightReport): SarifLog {
  // Deduplicate rules by InsightKind
  const ruleMap = new Map<InsightKind, SarifRule>();
  for (const insight of report.insights) {
    if (!ruleMap.has(insight.type)) {
      ruleMap.set(insight.type, insightToRule(insight));
    }
  }

  const results: SarifResult[] = report.insights.flatMap(insightToResults);

  return {
    version: '2.1.0',
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'magus-typescript-viewer',
            version: '1.0.0',
            informationUri: 'https://github.com/neurotypic-ai/magus-typescript-viewer',
            rules: Array.from(ruleMap.values()),
          },
        },
        results,
      },
    ],
  };
}
