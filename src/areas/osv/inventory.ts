import { z } from 'zod';
import type { CommandContext } from '../../core/context.js';
import { ToilError } from '../../core/errors.js';
import { STDIN_OVER_MCP } from '../../core/files.js';

/**
 * The dependency inventory the vulnerability sources check (`toil osv vulns`,
 * `toil ossindex vulns`): `toil deps scan` output from `--from <file>` or
 * stdin, as its whole envelope, its `data`, or a bare list of packages, and
 * the old `deps frisk` filters over it. Each source reads the same inventory,
 * so the inventory is filed once and photocopied for every department.
 */

const inventoryPackage = z.object({
  name: z.string(),
  version: z.string(),
  ecosystem: z.string(),
  source: z.string().optional(),
  type: z.string().optional(),
  scope: z.string().optional(),
});
export type InventoryPackage = z.output<typeof inventoryPackage>;

/** The parts of a command's context an inventory read needs. */
export type InventoryContext = Pick<CommandContext<unknown>, 'files'>;

export const FROM_DESCRIPTION = 'Inventory to check: a file holding toil deps scan output (its envelope, its data, or a list of packages). Omitted, it is read from stdin on the CLI';
export const ECOSYSTEM_DESCRIPTION = 'Filter to one ecosystem: npm, nuget, maven, all (default: "all")';
export const DIRECT_ONLY_DESCRIPTION = 'Only scan direct dependencies (default: include transitive)';
export const INCLUDE_DEV_DESCRIPTION = 'Include dev/test dependencies (default: false)';

/** The input fields and CLI flags every vulnerability source shares. */
export const inventoryFields = {
  from: z.string().optional().describe(FROM_DESCRIPTION),
  ecosystem: z.string().optional().describe(ECOSYSTEM_DESCRIPTION),
  directOnly: z.boolean().optional().describe(DIRECT_ONLY_DESCRIPTION),
  includeDev: z.boolean().optional().describe(INCLUDE_DEV_DESCRIPTION),
};

export const inventoryOptions = [
  { flags: '--from <file>', field: 'from', description: FROM_DESCRIPTION },
  { flags: '--ecosystem <ecosystem>', field: 'ecosystem', description: ECOSYSTEM_DESCRIPTION },
  { flags: '--direct-only', field: 'directOnly', description: DIRECT_ONLY_DESCRIPTION },
  { flags: '--include-dev', field: 'includeDev', description: INCLUDE_DEV_DESCRIPTION },
];

/** The inventory's packages, from `from` or stdin, or an INVALID_INPUT that says what was wrong with it. */
export function readInventory(ctx: InventoryContext, from: string | undefined, command: string): InventoryPackage[] {
  const where = from === undefined || from === '-' ? 'stdin' : `"${from}"`;
  let text: string;
  try {
    text = ctx.files.readText(from ?? '-');
  } catch (err) {
    if (err === STDIN_OVER_MCP && from === undefined) {
      throw new ToilError('INVALID_INPUT', 'No inventory to check: pass from, a file holding toil deps scan output. Over MCP there is no stdin to read it from.', {
        fix: 'Write toil deps scan output to a file in the workspace, then pass its path as from.',
      });
    }
    throw err;
  }
  const fix = `Pass the output of toil deps scan, e.g. toil deps scan | toil ${command}, or --from <file> holding it.`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ToilError('INVALID_INPUT', `The inventory from ${where} isn't JSON.`, { fix });
  }
  const record = (value: unknown) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);
  const envelope = record(parsed);
  if (envelope?.ok === false) {
    const message = record(envelope.error)?.message;
    throw new ToilError('INVALID_INPUT', `The inventory from ${where} is a failed result${typeof message === 'string' ? `: ${message}` : ''}.`, {
      fix: 'Fix what made the scan fail, then run it again.',
    });
  }
  const list = Array.isArray(parsed) ? parsed : (record(envelope?.data)?.packages ?? envelope?.packages);
  if (!Array.isArray(list)) throw new ToilError('INVALID_INPUT', `The inventory from ${where} has no packages list.`, { fix });
  const packages = z.array(inventoryPackage).safeParse(list);
  if (!packages.success) {
    const issue = packages.error.issues[0];
    throw new ToilError('INVALID_INPUT', `The inventory from ${where} has a package without a usable ${String(issue?.path.at(-1) ?? 'field')} (packages[${String(issue?.path[0] ?? '?')}]).`, {
      fix: 'Each package needs a name, version and ecosystem, as toil deps scan writes them.',
      details: packages.error.issues.slice(0, 5).map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return packages.data;
}

/**
 * What the old `deps frisk` scanned: the chosen ecosystem (`all`, or one; any
 * other value matches nothing, suspected bug #91 item 24), transitive
 * dependencies unless `directOnly`, and production ones unless `includeDev`.
 */
export function selectPackages(packages: InventoryPackage[], input: { ecosystem?: string | undefined; directOnly?: boolean | undefined; includeDev?: boolean | undefined }): InventoryPackage[] {
  const eco = input.ecosystem ?? 'all';
  return packages.filter((p) => (eco === 'all' || p.ecosystem === eco) && !(input.directOnly === true && p.type === 'transitive') && (input.includeDev === true || p.scope !== 'dev'));
}

/** One finding, as the old `deps frisk` shaped it for every source. */
export interface Vulnerability {
  id: string;
  summary: string;
  severity: string;
  cvss: number | null;
  aliases: string[];
  remediation: { fixAvailable: boolean; fixedVersions: string[]; advice: string };
  references: string[];
}

export type VulnerablePackage = InventoryPackage & { vulnerabilities: Vulnerability[] };

/** The old `deps frisk` result for one source. `tier` is `full` whenever a source answered, as it always was on success. */
export function friskData(source: string, scanned: number, packages: VulnerablePackage[]) {
  return { tier: 'full' as const, source, sourcesQueried: [source], sourceErrors: [] as Array<{ source: string; error: string }>, scanned, vulnerable: packages.length, packages };
}

/** The predecessor's per-request timeout for every source request. */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Batches go one after another; ten minutes covers a large monorepo's inventory at the request timeout's worst. */
export const TIME_LIMIT_MS = 600_000;
