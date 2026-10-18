import { ToilError } from '../../../core/errors.js';
import type { UtilInput } from '../kit/input.js';
import type { Verifier } from '../kit/verify.js';
import { capital, MAX_MESSAGE, type Finding, type FindingsSummary, type ReaderContext, type Skips } from './shared.js';

/**
 * SARIF 2.1.0, the format scanners (CodeQL, Semgrep, ESLint, Checkmarx…)
 * export. It's JSON, which has no streaming reader in the kit, so the file
 * is read whole, within the input cap (64 MiB): past it the read is
 * INVALID_INPUT naming the cap, not a partial answer.
 *
 * SARIF declares no totals of its own, so there's nothing to recount; that
 * is said as UNVERIFIED rather than left out. What can be checked is the
 * document's own cross-references: a result's `ruleIndex` must point at
 * the rule its `ruleId` names (`REPORT_SARIF_INCONSISTENT` when not).
 * Each result's level follows the spec's order: the result's own, else
 * its rule's default configuration, else `warning` for a failure and
 * `none` for anything else. A severity, like a priority, is whatever
 * the last form to touch it said.
 */

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const get = (value: unknown, ...keys: string[]): unknown => {
  let at = value;
  for (const key of keys) at = isObject(at) ? at[key] : undefined;
  return at;
};

/** A message: its text, else the rule's message string with `{0}`-style arguments filled in. */
function messageText(message: unknown, rule: Json | undefined): string | null {
  const text = str(get(message, 'text'));
  let out = text;
  if (out === null) {
    const id = str(get(message, 'id'));
    const template = id === null ? null : str(get(rule, 'messageStrings', id, 'text'));
    if (template !== null) {
      const args = get(message, 'arguments');
      out = template.replace(/\{(\d+)\}/g, (whole, n: string) => (Array.isArray(args) && typeof args[Number(n)] === 'string' ? (args[Number(n)] as string) : whole));
    }
  }
  if (out === null) return null;
  return out.length > MAX_MESSAGE ? `${out.slice(0, MAX_MESSAGE)}…` : out;
}

export async function readSarif(input: UtilInput, v: Verifier, skips: Skips, ctx: ReaderContext): Promise<FindingsSummary> {
  let doc: unknown;
  try {
    doc = JSON.parse(await input.text());
  } catch (err) {
    if (err instanceof ToilError) throw err;
    throw new ToilError('INVALID_INPUT', `${capital(input.label)} is not valid JSON, so not a SARIF report: ${(err as Error).message}.`, { fix: 'Pass the .sarif file as the tool wrote it, whole.' });
  }
  if (!isObject(doc) || !Array.isArray(doc.runs)) {
    throw new ToilError('INVALID_INPUT', `${capital(input.label)} is JSON but not a SARIF log: it has no "runs" array.`, { fix: 'Pass a SARIF 2.1.0 file, or --format (format over MCP) for the report it is.' });
  }
  if (doc.version !== '2.1.0') v.approximated('sarif.version', `the file says SARIF version ${JSON.stringify(doc.version ?? null)}; it was read as 2.1.0`);
  v.unchecked('findings.totals', 'SARIF declares no totals of its own to recount');

  const runs: FindingsSummary['runs'] = [];
  const results: Finding[] = [];
  const byLevel: Record<string, number> = {};
  doc.runs.forEach((run, r) => {
    if (!isObject(run)) {
      skips.add('run', 'not an object');
      return;
    }
    const tool = str(get(run, 'tool', 'driver', 'name'));
    const version = str(get(run, 'tool', 'driver', 'semanticVersion')) ?? str(get(run, 'tool', 'driver', 'version'));
    const rulesRaw = get(run, 'tool', 'driver', 'rules');
    const rules = Array.isArray(rulesRaw) ? rulesRaw : [];
    const artifacts = Array.isArray(run.artifacts) ? run.artifacts : [];
    const invocations = Array.isArray(run.invocations) ? run.invocations : [];
    if (invocations.some((i) => get(i, 'executionSuccessful') === false)) {
      ctx.warn({ code: 'REPORT_TOOL_FAILED', message: `Run ${r + 1}${tool ? ` (${tool})` : ''} says its execution did not succeed, so its results may be incomplete.` });
    }
    const list = Array.isArray(run.results) ? run.results : [];
    runs.push({ tool, version, results: list.length });
    list.forEach((result, i) => {
      if (!isObject(result)) {
        skips.add('result', 'not an object');
        return;
      }
      const index = typeof result.ruleIndex === 'number' ? result.ruleIndex : typeof get(result, 'rule', 'index') === 'number' ? (get(result, 'rule', 'index') as number) : undefined;
      const indexed = index === undefined ? undefined : rules[index];
      const ruleObj = isObject(indexed) ? indexed : undefined;
      const ruleId = str(result.ruleId) ?? str(get(result, 'rule', 'id'));
      if (index !== undefined && ruleId !== null) {
        const id = str(ruleObj?.id);
        // A ruleId may be hierarchical ("js/rule/sub"), naming a sub-rule of the indexed one.
        v.expect('sarif.ruleIndex', id !== null && (ruleId === id || ruleId.startsWith(`${id}/`)), { at: `runs[${r}].results[${i}]`, expected: ruleId, actual: id }, {
          code: 'REPORT_SARIF_INCONSISTENT',
          message: `runs[${r}].results[${i}] names rule "${ruleId}", but its ruleIndex ${index} points at ${id === null ? 'no rule' : `"${id}"`}.`,
        });
      }
      const kind = str(result.kind) ?? 'fail';
      const level = str(result.level) ?? str(get(ruleObj, 'defaultConfiguration', 'level')) ?? (kind === 'fail' ? 'warning' : 'none');
      const firstLocation = Array.isArray(result.locations) ? get(result.locations[0], 'physicalLocation') : undefined;
      const artifact = get(firstLocation, 'artifactLocation');
      const artifactIndex = get(artifact, 'index');
      const file = str(get(artifact, 'uri')) ?? (typeof artifactIndex === 'number' ? str(get(artifacts[artifactIndex], 'location', 'uri')) : null);
      const startLine = get(firstLocation, 'region', 'startLine');
      const suppressions = result.suppressions;
      const suppressed = Array.isArray(suppressions) && suppressions.some((s) => (str(get(s, 'status')) ?? 'accepted') === 'accepted');
      byLevel[level] = (byLevel[level] ?? 0) + 1;
      results.push({
        tool,
        rule: ruleId ?? str(ruleObj?.id),
        level,
        kind,
        file,
        line: typeof startLine === 'number' ? startLine : null,
        message: messageText(result.message, ruleObj),
        suppressed,
      });
    });
  });
  return { runs, total: results.length, byLevel, results };
}
