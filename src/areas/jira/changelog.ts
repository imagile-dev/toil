import { z } from 'zod';

/**
 * `--changelog` for `jira issue search`, shared by both Jira deployments: each
 * issue comes back with its change history inline (`expand=changelog`), so a
 * caller that wants the history of many issues makes one search instead of one
 * `jira issue history` call per issue.
 *
 * Both APIs may send a changelog shorter than the issue has. toil returns what
 * they sent, unchanged, and says how many issues were cut short, because a
 * history that quietly stops at the hundredth entry is a history somebody will
 * one day treat as complete. Completeness, like the minutes of a stand-up, is
 * only as good as the attendance.
 */

export const changelogField = z
  .boolean()
  .optional()
  .describe('Return each issue with its change history (changelog), as Jira sends it inline; a long history may arrive cut short, which a warning names');

export const changelogOption = {
  flags: '--changelog',
  field: 'changelog',
  description: "Include each issue's change history (changelog), so no `jira issue history` call per issue is needed; a very long history may come back cut short (a warning says so)",
};

/** How many issues have an inline changelog holding fewer entries than Jira says the issue has. */
export function truncatedChangelogs(issues: ReadonlyArray<Record<string, unknown>>): number {
  let cut = 0;
  for (const issue of issues) {
    const log = issue.changelog;
    if (typeof log !== 'object' || log === null) continue;
    const { total, histories } = log as { total?: unknown; histories?: unknown };
    if (typeof total === 'number' && Array.isArray(histories) && total > histories.length) cut++;
  }
  return cut;
}

/** One warning when any issue's changelog was cut short, naming the command that reads a whole history. */
export function warnTruncatedChangelogs(warn: (w: { code: string; message: string }) => void, code: string, issues: ReadonlyArray<Record<string, unknown>>): void {
  const cut = truncatedChangelogs(issues);
  if (cut === 0) return;
  warn({
    code,
    message: `Jira sent a shortened changelog for ${cut} of ${issues.length} issue${issues.length === 1 ? '' : 's'}, so their older changes are missing here. \`jira issue history <key>\` reads the whole history of one issue.`,
  });
}
