import type { InsightCategory, InsightReport, InsightResult } from '../../server/insights/types';

function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportInsightsJson(report: InsightReport): void {
  const json = JSON.stringify(report, null, 2);
  downloadBlob(json, 'insights-report.json', 'application/json');
}

const categoryLabels: Record<InsightCategory, string> = {
  'dependency-health': 'Dependency Health',
  'structural-complexity': 'Structural Complexity',
  'api-surface': 'API Surface',
  connectivity: 'Connectivity',
  maintenance: 'Maintenance',
};

const categoryOrder: InsightCategory[] = [
  'dependency-health',
  'structural-complexity',
  'api-surface',
  'connectivity',
  'maintenance',
];

export function exportInsightsMarkdown(report: InsightReport): void {
  const lines: string[] = [];

  lines.push('# Codebase Insights Report');
  lines.push('');
  lines.push(`**Health Score:** ${report.healthScore.toString()}/100`);
  lines.push(`**Computed:** ${report.computedAt}`);
  if (report.packageId) {
    lines.push(`**Package:** ${report.packageId}`);
  }
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('|----------|-------|');
  lines.push(`| Critical | ${report.summary.critical.toString()} |`);
  lines.push(`| Warning  | ${report.summary.warning.toString()} |`);
  lines.push(`| Info     | ${report.summary.info.toString()} |`);
  lines.push('');

  // Group by category
  const byCategory = new Map<InsightCategory, InsightResult[]>();
  for (const insight of report.insights) {
    let arr = byCategory.get(insight.category);
    if (!arr) {
      arr = [];
      byCategory.set(insight.category, arr);
    }
    arr.push(insight);
  }

  for (const cat of categoryOrder) {
    const insights = byCategory.get(cat);
    if (!insights || insights.length === 0) continue;

    lines.push(`## ${categoryLabels[cat]}`);
    lines.push('');

    for (const insight of insights) {
      const severityBadge = insight.severity === 'critical' ? '**CRITICAL**' : insight.severity === 'warning' ? '*Warning*' : 'Info';
      lines.push(`### ${insight.title} [${severityBadge}]`);
      lines.push('');
      lines.push(insight.description);
      lines.push('');

      if (insight.entities.length > 0) {
        lines.push('| Entity | Kind | Detail |');
        lines.push('|--------|------|--------|');
        for (const entity of insight.entities.slice(0, 50)) {
          const detail = entity.detail ?? '';
          lines.push(`| ${entity.name} | ${entity.kind} | ${detail} |`);
        }
        if (insight.entities.length > 50) {
          lines.push(`| ... | | +${(insight.entities.length - 50).toString()} more |`);
        }
        lines.push('');
      }
    }
  }

  const markdown = lines.join('\n');
  downloadBlob(markdown, 'insights-report.md', 'text/markdown');
}
