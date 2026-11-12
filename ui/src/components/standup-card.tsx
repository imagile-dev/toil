/**
 * The stand-up on the Summary: the same report the stand-up page folds for its
 * default range (since the last working day), as the same compact rows, a few of
 * them, and a way in to the rest. It loads and words everything through the
 * stand-up page's own parts (`useStandupReport`, `BucketRow`, `PersonName`,
 * `Dash`), so the two can't disagree. The rows are the ones that matter first:
 * questions nobody has answered, then what is blocked, done, in progress. With
 * no sync behind it, the rows are a dash that says "not read yet", never "nothing
 * happened" (principle 12).
 */

import { useData } from '../data.ts';
import { standupHref } from '../format.ts';
import { defaultRange, sinceText, topRows } from '../model/standup.ts';
import { dayOf } from '../model/worklog.ts';
import { BucketRow, NotRead, PersonName, useStandupReport } from '../views/Standup.tsx';
import type { WorklogApi } from '../worklog.ts';
import '../views/standup.css';

/** How many rows the card shows; the page has the rest. */
export const CARD_ROWS = 5;

const NONE = new Set<string>();

export function StandupCard({ api }: { api: WorklogApi }) {
  const { toilProject, now } = useData();
  const today = dayOf(now)!;
  const [loaded] = useStandupReport(api, defaultRange(today));
  const report = loaded?.ok ? loaded.value.report : null;
  const rows = report ? topRows(report, CARD_ROWS) : [];
  return (
    <section className="sum-standup" aria-labelledby="sum-standup-title" data-standup-card="">
      <div className="sum-standup__head">
        <h2 id="sum-standup-title">Stand-up</h2>
        <span className="note" data-standup-range="">
          {report ? sinceText(report, today) : sinceText(defaultRange(today), today)}
        </span>
        <a className="btn btn--small" href={standupHref(toilProject.name)} data-standup-open="">
          Open the full stand-up
        </a>
      </div>
      {!loaded ? (
        <p className="note" role="status">
          Folding the stand-up.
        </p>
      ) : !loaded.ok ? (
        <p role="alert" className="failure">
          {loaded.message}
        </p>
      ) : (
        <>
          <p className="sum-standup__line" data-standup-team="">
            {report!.sprintLine ?? (report!.asOf ? 'No current sprint' : 'Sprint not read yet')}
          </p>
          {rows.length === 0 ? (
            report!.asOf === null ? (
              <NotRead />
            ) : (
              <p className="note">Nothing recorded since then.</p>
            )
          ) : (
            <ul className="sum-standup__rows">
              {rows.map((r) => (
                <li key={`${r.group.key}/${r.bucket}`} className="sum-standup__row">
                  <PersonName group={r.group} />
                  <dl className="standup-rows">
                    <BucketRow report={report!} bucket={r.bucket} lines={r.group.lines[r.bucket].filter((l) => r.bucket !== 'comments' || l.comment?.outstanding)} cited={NONE} />
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
