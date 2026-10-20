/**
 * The names and descriptions of core's output inputs, on their own so that
 * command definitions can reserve them without importing the machinery
 * behind them (src/core/output/shape.ts). Fields with no dependencies, the
 * one kind of form that never needs a countersignature.
 */

export const OUTPUT_FORMAT_FIELD = 'outputFormat';
export const SUMMARY_FILE_FIELD = 'summaryFile';
export const OUTPUT_FORMATS = ['json', 'toon'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const OUTPUT_FORMAT_DESCRIPTION =
  'How data is written: "json" (the default) or "toon", a compact text form of tables (one header, then one line per row) that costs far fewer tokens for uniform rows. Only data changes; ok, error and meta stay JSON, and meta.format says "toon".';
export const SUMMARY_FILE_DESCRIPTION = `Write the whole of data, as JSON, to this file in the workspace (it must not exist yet), and return a summary in its place: the whole result when it is small, else the first or a sample of its rows with per-column stats, under about 1,500 tokens. meta.summary says which rule applied, the full row count and the file. Use it for any read that may return more than a page.`;
