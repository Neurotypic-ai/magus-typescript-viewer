import type { DatabaseRow, IDatabaseAdapter } from '../db/adapter/IDatabaseAdapter';
import type { InsightReport } from './types';

// ── Row type for query results ──────────────────────────────────────────────

interface InsightReportRow extends DatabaseRow {
  id: string;
  package_id: string | null;
  computed_at: string;
  health_score: number | string;
  report_json: string;
}

// ── Table initialization ────────────────────────────────────────────────────

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS insight_reports (
    id INTEGER PRIMARY KEY,
    package_id TEXT,
    computed_at TEXT NOT NULL,
    health_score INTEGER NOT NULL,
    report_json TEXT NOT NULL
  )
`;

const tableInitialization = new WeakMap<IDatabaseAdapter, Promise<void>>();

function parseReportJson(reportJson: string): InsightReport | null {
  try {
    return JSON.parse(reportJson) as InsightReport;
  } catch {
    return null;
  }
}

async function ensureTable(adapter: IDatabaseAdapter): Promise<void> {
  const existingInitialization = tableInitialization.get(adapter);
  if (existingInitialization) {
    return existingInitialization;
  }

  const initialization = adapter
    .query(CREATE_TABLE_SQL)
    .then(() => undefined)
    .catch((error: unknown) => {
      tableInitialization.delete(adapter);
      throw error;
    });

  tableInitialization.set(adapter, initialization);
  await initialization;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Stores an InsightReport in the database as serialized JSON.
 */
export async function storeInsightReport(adapter: IDatabaseAdapter, report: InsightReport): Promise<void> {
  await ensureTable(adapter);

  const reportJson = JSON.stringify(report);
  const packageId = report.packageId ?? null;

  await adapter.query(
    `INSERT INTO insight_reports (package_id, computed_at, health_score, report_json) VALUES (?, ?, ?, ?)`,
    [packageId, report.computedAt, report.healthScore, reportJson],
  );
}

/**
 * Retrieves the most recent InsightReport, optionally filtered by package ID.
 * Returns null if no reports have been stored.
 */
export async function getLatestReport(adapter: IDatabaseAdapter, packageId?: string): Promise<InsightReport | null> {
  await ensureTable(adapter);

  const whereClause = packageId ? 'package_id = ?' : 'package_id IS NULL';
  const sql = `SELECT id, package_id, computed_at, health_score, report_json FROM insight_reports WHERE ${whereClause} ORDER BY computed_at DESC LIMIT 50`;
  const params = packageId ? [packageId] : [];
  const rows = await adapter.query<InsightReportRow>(sql, params);

  for (const row of rows) {
    const parsed = parseReportJson(row.report_json);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

/**
 * Retrieves the most recent insight reports, optionally filtered by package ID.
 * Results are ordered newest-first. Default limit is 10.
 */
export async function getReportHistory(
  adapter: IDatabaseAdapter,
  packageId?: string,
  limit = 10,
): Promise<InsightReport[]> {
  await ensureTable(adapter);

  const whereClause = packageId ? 'package_id = ?' : 'package_id IS NULL';
  const sql = `SELECT id, package_id, computed_at, health_score, report_json FROM insight_reports WHERE ${whereClause} ORDER BY computed_at DESC LIMIT ?`;
  const params = packageId ? [packageId, limit] : [limit];
  const rows = await adapter.query<InsightReportRow>(sql, params);

  return rows
    .map((row) => parseReportJson(row.report_json))
    .filter((report): report is InsightReport => report !== null);
}
