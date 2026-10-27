import { z } from 'zod';

/**
 * `--changelog` for `jira issue search`, shared by both Jira deployments: each
 * issue comes back with its change history inline (`expand=changelog`), so a
 * caller that wants the history of many issues makes one search instead of one
 * `jira issue history` call per issue.
 *
 * Both APIs may send a changelog shorter than the issue has (Cloud's enhanced
 * search documents at most 20 entries per issue, newest first, and reports
 * `total` as the number on the page, so a cut cannot be seen from it). toil
 * returns what they sent, unchanged, and says how many issues may be cut
 * short, because a history that quietly stops at the twentieth entry is a
 * history somebody will one day treat as complete. Completeness, like the minutes of a stand-up, is
 * only as good as the attendance.
 */

export const changelogField = z
  .boolean()
  .optional()
  .describe('Return each issue with its change history (changelog), in Jira\'s own order (Cloud: newest first, at most 20 entries); a warning names issues that may be cut short');

export const changelogOption = {
  flags: '--changelog',
  field: 'changelog',
  description: "Include each issue's change history (changelog), so no `jira issue history` call per issue is needed; a long history may come back cut short (Cloud: at most 20 entries, newest first); a warning names the issues that may be",
};

/**
 * How many issues may have an inline changelog shorter than the issue's real
 * history: `total` is more than the entries sent, the entries fill the page
 * (`histories.length >= maxResults`), or Jira sent no `total` or `maxResults`
 * to judge by. Cloud's `total` only counts the page, so the page being full is
 * the sign that matters there.
 */
export function truncatedChangelogs(issues: ReadonlyArray<Record<string, unknown>>): number {
  let cut = 0;
  for (const issue of issues) {
    const log = issue.changelog;
    if (typeof log !== 'object' || log === null) continue;
    const { total, maxResults, histories } = log as { total?: unknown; maxResults?: unknown; histories?: unknown };
    if (!Array.isArray(histories)) continue;
    if (typeof total !== 'number' || typeof maxResults !== 'number' || total > histories.length || histories.length >= maxResults) cut++;
  }
  return cut;
}

/** One warning when any issue's changelog was cut short, naming the command that reads a whole history. */
export function warnTruncatedChangelogs(warn: (w: { code: string; message: string }) => void, code: string, issues: ReadonlyArray<Record<string, unknown>>): void {
  const cut = truncatedChangelogs(issues);
  if (cut === 0) return;
  warn({
    code,
    message: `The changelog of ${cut} of ${issues.length} issue${issues.length === 1 ? '' : 's'} may be cut short, so older changes may be missing here. \`jira issue history <key>\` reads the whole history of one issue.`,
  });
}
