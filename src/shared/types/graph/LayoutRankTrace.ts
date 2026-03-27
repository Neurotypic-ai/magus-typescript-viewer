/**
 * Rank computation trace for a single node — records each import's contribution
 * to the node's final layoutWeight so the debug panel can display a step-by-step
 * breakdown of the Sugiyama longest-path calculation.
 */

export interface RankContribution {
  /** ID of the imported (target) module */
  importedId: string;
  /** Human-readable label of the imported module */
  importedLabel: string;
  /** How many nodes import this target (drives stepCost via log₂) */
  fanIn: number;
  /** Edge traversal cost: 1 + log₂(max(1, fanIn)) */
  stepCost: number;
  /** Recursive weighted depth of the imported node */
  depth: number;
  /** stepCost + depth — the candidate rank for this import path */
  total: number;
  /** True when this import produced the maximum total (the winning path) */
  isWinner: boolean;
}

export interface LayoutRankTrace {
  /** Positive weighted depth before negation */
  weightedDepth: number;
  /** Final layoutWeight applied to the node (-weightedDepth, or 0 for leaf) */
  layoutWeight: number;
  /** Per-import contributions, sorted winners-first then by total descending */
  contributions: RankContribution[];
}
