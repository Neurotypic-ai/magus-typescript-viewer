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

/**
 * Ensures the insight_reports table exists.
 * Safe to call multiple times due to IF NOT EXISTS.
 */
async function ensureTable(adapter: IDatabaseAdapter): Promise<void> {
  await adapter.query(CREATE_TABLE_SQL);
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

  const sql = packageId
    ? `SELECT id, package_id, computed_at, health_score, report_json FROM insight_reports WHERE package_id = ? ORDER BY computed_at DESC LIMIT 1`
    : `SELECT id, package_id, computed_at, health_score, report_json FROM insight_reports WHERE package_id IS NULL ORDER BY computed_at DESC LIMIT 1`;

  const params = packageId ? [packageId] : [];
  const rows = await adapter.query<InsightReportRow>(sql, params);

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  if (!row) return null;
  return JSON.parse(row.report_json) as InsightReport;
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

  const sql = packageId
    ? `SELECT id, package_id, computed_at, health_score, report_json FROM insight_reports WHERE package_id = ? ORDER BY computed_at DESC LIMIT ?`
    : `SELECT id, package_id, computed_at, health_score, report_json FROM insight_reports WHERE package_id IS NULL ORDER BY computed_at DESC LIMIT ?`;

  const params = packageId ? [packageId, limit] : [limit];
  const rows = await adapter.query<InsightReportRow>(sql, params);

  return rows.map((row) => JSON.parse(row.report_json) as InsightReport);
}
