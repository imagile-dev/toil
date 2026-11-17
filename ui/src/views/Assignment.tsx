/**
 * One agent assignment (#293): its state and why, the report with the
 * server's citation checks, the questions, the branch implement mode made,
 * every proposal with a diff of what it would change, the record of what
 * the run started on, and the whole transcript. Apply asks the server to
 * run the proposal it stored when the run ended, through toil's write gate
 * (the connection's `writes`, and this press as the call's allow-write);
 * nothing else here can change a tracker. The case file, with the
 * signature line at the bottom of every page.
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Button } from 'react-aria-components';
import { usePlain } from '../plain-words.ts';
import { AssignModal, StateChip, assignmentHref, usageText, POLL_MS } from '../assign/views.tsx';
import { ADAPTER_NAME, applyResultText, liveLine, modeInfo, richText, renewRefusal, runMs, runText, writesOffText, type AssignedProposal, type Assignment, type AssignmentRecord } from '../assign/model.ts';
import { StaleNote } from '../components/stale.tsx';
import { AnswerText, ItemLink } from '../components/items.tsx';
import { Card, Cluster, DataTable, Path, Scroller } from '../components/layout.tsx';
import { ProposalCard } from '../components/proposal.tsx';
import { UsageFooter } from '../components/usage.tsx';
import { useData } from '../data.ts';
import { Empty, EmptyLink } from '../components/empty.tsx';
import { AGENT_SETTINGS_HREF, dateTime, shortKey, sourceLabel, toilProjectHref } from '../format.ts';
import { EditLink, Help } from '../components/help.tsx';
import { Unread } from '../components/unread.tsx';
import { SummaryChevron } from '../components/disclosure.tsx';
import { fieldName } from '../model/readiness.ts';

const when = (iso: string | null) => (iso ? dateTime(iso) : 'not yet');

export function AssignmentView({ id }: { id: string }) {
  const { toilProject, assignments: api, now, byId } = useData();
  const plain = usePlain();
  const [record, setRecord] = useState<AssignmentRecord | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!api) return;
    let live = true;
    api.get(id).then(
      (r) => live && (setRecord(r), setProblem(null)),
      (e: unknown) => live && setProblem(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [api, id, tick]);
  const running = record?.state === 'working' || (record?.state === 'queued' && record.waiting === 'slot');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [running, reload]);

  if (!api || (problem && !record)) {
    return (
      <>
        <h1 tabIndex={-1}>No such assignment</h1>
        <Empty message={problem ?? 'This view has no agent assignments.'} action={<EmptyLink href={toilProjectHref(toilProject.name)}>Back to {toilProject.name}</EmptyLink>} />
      </>
    );
  }
  if (!record) return <p className="note">Reading the assignment…</p>;

  // `what` is the line to show once the call returns: a fixed sentence, or one read from the assignment it returned.
  const act = async (what: string | ((after: Assignment) => string), run: () => Promise<Assignment>) => {
    setBusy(true);
    setSaid(null);
    try {
      const after = await run();
      setSaid(typeof what === 'string' ? what : what(after));
    } catch (e) {
      setSaid(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      reload();
    }
  };
  const a = record;
  const waitingStart = a.state === 'queued' && a.waiting === 'start';
  // What leads the head: a proposal waits and none was applied, so nothing has changed and the next step is the reader's.
  const open = a.proposals.filter((p) => p.status === 'pending');
  const waitsOnYou = open.length > 0 && !a.proposals.some((p) => p.status === 'applied');

  // A refine or a rule fix ends in the change to review, so its proposals lead, above the questions and what the agent said; elsewhere the report leads.
  const proposalsFirst = a.mode === 'refine' || Boolean(a.rules?.length);
  const area = byId.get(a.item)?.source.area;
  const tracker = area ? sourceLabel(area) : 'the tracker';
  // A refine or a rule fix ends in proposals to apply, so Mark reviewed sits below them rather than beside the page's first step.
  const markReviewed = (
    <Button className="btn" onPress={() => act('Marked reviewed.', () => api.finish(a.id))} isDisabled={busy}>
      Mark reviewed
    </Button>
  );
  const nameOf = (id: string) => {
    const it = byId.get(id);
    return it ? `${sourceLabel(it.source.area)} ${shortKey(it)}` : id;
  };
  const proposals = a.proposals.length > 0 && (
    <section className="proposals" aria-labelledby="assign-proposals">
      <h2 id="assign-proposals">Proposals</h2>
      <p className="note">
        Each change the agent proposes.{waitsOnYou ? '' : ` Nothing changes in ${tracker} until you press Apply.`} <Help topic="proposal" note="Apply runs its toil command through the write gate: the connection needs writes on, and this press is the call's allow-write." />
      </p>
      {a.proposals.map((p) => (
        <AssignedCard key={p.id} p={p} tracker={tracker} quiet={Boolean(a.rules?.length)} busy={busy} onApply={() => act((after) => applyResultText(after, p.id, p.title), () => api.apply(a.id, p.id))} onDismiss={() => act(`Dismissed: ${p.title}.`, () => api.dismiss(a.id, p.id))} />
      ))}
    </section>
  );

  return (
    <>
      <div className="view-head">
        <p className="eyebrow">
          <a href={toilProjectHref(a.toilProject)}>{a.toilProject}</a> · Agent assignment
        </p>
        <h1 tabIndex={-1}>
          {a.rules?.length ? 'Fix with AI agent' : modeInfo(a.mode, plain.on).label}: {a.itemTitle}
        </h1>
        {a.rules?.length ? (
          <p data-assignment-rule="">
            To meet {a.rules.length === 1 ? 'the ticket rule' : 'the ticket rules'}{' '}
            {a.rules.map((r, i) => (
              <Fragment key={r.rule}>
                {i > 0 && (i === a.rules!.length - 1 ? ' and ' : ', ')}
                <strong>{r.name}</strong>
              </Fragment>
            ))}
            .
          </p>
        ) : null}
        {waitsOnYou && (
          <p className="assign-lead" data-assignment-lead="">
            Nothing has changed yet. Review {open.length === 1 ? 'the proposal below and apply it' : 'the proposals below and apply the ones you want'}.
          </p>
        )}
        <p className="item-meta">
          <StateChip a={a} /> <ItemLink id={a.item} /> · {a.adapter ? ADAPTER_NAME[a.adapter] : 'no adapter chosen yet'} <EditLink href={AGENT_SETTINGS_HREF} label="Edit the agent settings" /> · {a.origin === 'tracker' ? `queued by the tracker (${a.trigger})` : 'assigned in Toil UI'}
        </p>
        <details className="assign-run" data-assignment-run="">
          <summary>
            <SummaryChevron />
            Run details
          </summary>
          <p className="note">
            Created {when(a.createdAt)}; started {when(a.startedAt)}; {a.endedAt ? `ended ${when(a.endedAt)}` : 'still going'}; ran {runText(a.ranMs ?? runMs(a, now))}; {usageText(a)}. {modeInfo(a.mode, plain.on).changes}
          </p>
        </details>
      </div>

      {a.stop && (
        <p role="note" className={a.stop.reason === 'injection' ? 'assign-warn' : 'failure'}>
          {a.stop.message} {a.stop.fix}
        </p>
      )}

      {a.stale && (
        <div className="stale-block">
          <StaleNote stale={a.stale} />
          <p className="note">{renewRefusal(a) ?? "Renew starts it again as a fresh assignment on today's instructions, with what this run left as context. This one stays as it is."}</p>
        </div>
      )}
      {a.renews && (
        <p className="note">
          This renews <a href={assignmentHref(a.toilProject, a.renews)}>an earlier assignment</a> on the same item, which started on older instructions; what it left was in this run's prompt.
        </p>
      )}
      {a.renewedBy && (
        <p className="note">
          Renewed as <a href={assignmentHref(a.toilProject, a.renewedBy)}>a fresh assignment</a> on today's instructions.
        </p>
      )}

      <Cluster className="assign-actions">
        {a.stale && !renewRefusal(a) && (
          <Button
            className="btn btn--accent"
            onPress={() =>
              act('Renewed.', async () => {
                const fresh = await api.renew(a.id);
                window.location.hash = assignmentHref(fresh.toilProject, fresh.id);
                return fresh;
              })
            }
            isDisabled={busy}
            data-renew=""
          >
            Renew
          </Button>
        )}
        {waitingStart && (
          <Button className="btn btn--accent" onPress={() => setStarting(true)} isDisabled={busy}>
            Start…
          </Button>
        )}
        {(a.state === 'queued' || a.state === 'working') && (
          <Button className="btn" onPress={() => act(a.state === 'working' ? 'Stopping it.' : 'Taken off the queue.', () => api.cancel(a.id))} isDisabled={busy}>
            {a.state === 'working' ? 'Stop' : 'Take off the queue'}
          </Button>
        )}
        {a.state === 'needs-you' && !proposalsFirst && markReviewed}
        <span className="note" role="status">
          {said ?? ''}
        </span>
      </Cluster>
      {waitingStart && <AssignModal item={{ id: a.item, title: a.itemTitle }} start={a} isOpen={starting} onOpenChange={setStarting} onDone={reload} />}

      {a.state === 'working' && (
        <p className="assign-live" role="status" aria-live="polite" data-assignment-live="">
          {liveLine(a, nameOf, (id) => byId.get(id)?.parent ?? null)}
        </p>
      )}

      {proposalsFirst && proposals}
      {proposalsFirst && a.state === 'needs-you' && <Cluster className="assign-actions assign-actions--after">{markReviewed}</Cluster>}

      {a.questions.length > 0 && (
        <Card as="section" className="panel" aria-labelledby="assign-questions">
          <h2 id="assign-questions">Questions for you</h2>
          <ul className="rows">
            {a.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          <p className="note">{proposalsFirst ? `Answer these in ${tracker}, then ask for a new rewrite.` : `Answer these in ${tracker}, then assign it again.`}</p>
        </Card>
      )}

      {a.report && (
        <Card as="section" className="panel" aria-labelledby="assign-report">
          <h2 id="assign-report">{a.mode === 'investigate' ? 'Report' : 'What the agent said'}</h2>
          {(a.report.warnings.length > 0 || a.report.unverified.length > 0) && (
            <div className="answer-checks" role="note">
              {a.report.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}
          {a.report.parts.map((p, i) => (
            <AnswerText key={i} text={p.text} chips />
          ))}
          {a.usage && <UsageFooter usage={a.usage} />}
        </Card>
      )}

      {a.branch && (
        <Card as="section" className="panel" aria-labelledby="assign-branch">
          <h2 id="assign-branch">Branch {a.branch.name}</h2>
          <p>
            In a clone of {a.branch.repo} at <Path value={a.branch.folder} what="folder" />, {a.branch.onBranch ? `on ${a.branch.name}` : `not on ${a.branch.name}`}, with {a.branch.files.length === 1 ? 'one changed file' : `${a.branch.files.length} changed files`}, staged and not committed.
          </p>
          {a.branch.files.length > 0 && (
            <ul className="rows">
              {a.branch.files.map((f) => (
                <li key={`${f.status}:${f.path}`}>
                  <code>{f.path}</code> <span className="note">{f.status}</span>
                  {a.branch?.hidden?.includes(f.path) && <span className="assign-stop"> not in the diff below</span>}
                </li>
              ))}
            </ul>
          )}
          {a.branch.diff && (
            <Scroller label="The staged diff">
              <pre className="assign-diff">
                <code>{a.branch.diff}</code>
              </pre>
            </Scroller>
          )}
        </Card>
      )}

      {!proposalsFirst && proposals}

      {a.startedOn && (
        <details className="assign-record">
          <summary>What this run started on</summary>
          <dl className="fields">
            <dt>toil</dt>
            <dd>{a.startedOn.toil}</dd>
            <dt>Toil UI</dt>
            <dd>{a.startedOn.toilUi}</dd>
            <dt>Adapter</dt>
            <dd>
              {ADAPTER_NAME[a.startedOn.adapter]}, {a.startedOn.model ?? "the CLI's default model"}
            </dd>
            <dt>Skills</dt>
            <dd>{a.startedOn.skills.length ? a.startedOn.skills.join(', ') : 'none: Toil UI gives an assigned agent its tools and prompt only'}</dd>
            <dt>Tools</dt>
            <dd className="any-break">{a.startedOn.tools.join(', ')}</dd>
            <dt>Toil project</dt>
            <dd className="any-break">
              {a.startedOn.toilProject.name}, <code>{a.startedOn.toilProject.fingerprint ?? 'unread'}</code>
            </dd>
            <dt>Item</dt>
            <dd className="any-break">
              {a.startedOn.item.id}, updated {a.startedOn.item.updated ? dateTime(a.startedOn.item.updated) : 'at an unknown time'}, <code>{a.startedOn.item.fingerprint}</code>
            </dd>
            <dt>Prompt</dt>
            <dd className="any-break">
              <code>{a.startedOn.prompt}</code>
            </dd>
            <dt>Install fingerprint</dt>
            <dd className="any-break">
              {a.startedOn.fingerprint ? (
                <>
                  toil {a.startedOn.fingerprint.toil.version} at {a.startedOn.fingerprint.toil.commit?.slice(0, 7) ?? 'an unrecorded commit'}, Toil UI {a.startedOn.fingerprint.toilUi.version} at {a.startedOn.fingerprint.toilUi.commit?.slice(0, 7) ?? 'an unrecorded commit'}; skills{' '}
                  {Object.entries(a.startedOn.fingerprint.skills)
                    .map(([area, hash]) => `${area} ${hash.slice(0, 12)}`)
                    .join(', ') || 'none'}
                  ; Toil project <code>{a.startedOn.fingerprint.toilProject?.slice(0, 12) ?? 'unread'}</code>; prompts <code>{a.startedOn.fingerprint.prompts.slice(0, 12)}</code>
                </>
              ) : (
                'not recorded: this run started before Toil UI recorded one, so it is never called stale'
              )}
            </dd>
          </dl>
          <p className="note">Fingerprints are SHA-256 of what the run read, so a later look can tell whether the item, the Toil project or the prompt has changed since.</p>
        </details>
      )}

      {a.transcript.length > 0 && (
      <details className="assign-transcript">
        <summary>Transcript ({a.transcript.length === 1 ? '1 line' : `${a.transcript.length} lines`})</summary>
        <ol className="assign-lines">
          {a.transcript.map((t, i) => (
            <li key={i} className={`assign-line assign-line--${t.kind}`}>
              <p>
                <span className="note">{dateTime(t.at)}</span> <strong>{t.title}</strong>
              </p>
              {t.detail && (
                <pre className="assign-detail">
                  <code>{t.detail}</code>
                </pre>
              )}
            </li>
          ))}
        </ol>
      </details>
      )}
    </>
  );
}

const STATUS_WORD: Record<AssignedProposal['status'], string> = {
  pending: 'Proposed change, not applied',
  applied: 'Applied',
  failed: 'Not applied',
  dismissed: 'Dismissed',
};

/** One proposal with its diff, what came of it, and Apply and Dismiss while it waits. */
function AssignedCard({ p, tracker, quiet, busy, onApply, onDismiss }: { p: AssignedProposal; tracker: string; /** A rule fix: the agent's paragraph above already says why, so the card doesn't repeat it. */ quiet: boolean; busy: boolean; onApply: () => void; onDismiss: () => void }) {
  const { toilProject, byId } = useData();
  const open = p.status === 'pending' || p.status === 'failed';
  const area = byId.get(p.item)?.source.area ?? null;
  // Once applied, the table is a record of what it was and what it became, not a choice still to make.
  const applied = p.status === 'applied';
  const writesOff = writesOffText(p.outcome, area ? sourceLabel(area) : tracker);
  return (
    <ProposalCard
      proposal={p}
      kind={STATUS_WORD[p.status]}
      hideReason={quiet}
      lead={
        p.diff.length > 0 ? (
          <DataTable
            className="assign-diff-table"
            label={`What ${p.title} changes`}
            caption="What it changes"
            rows={p.diff}
            rowKey={(r) => r.field}
            columns={[
              { header: 'Field', label: 'Field', rowHeader: true, className: 'assign-diff-field', cell: (r) => <FieldName field={r.field} name={fieldName(r.field, toilProject.readiness, area)} /> },
              { header: applied ? 'Before' : 'Now', label: applied ? 'Before' : 'Now', className: 'assign-diff-value', cell: (r) => (r.before === null ? <Unread className="note" titled /> : r.before === '' ? <span className="note">empty</span> : <span className={applied ? 'assign-was' : 'assign-before'}>{richText(r.before)}</span>) },
              { header: applied ? 'After' : 'Proposed', label: applied ? 'After' : 'Proposed', className: 'assign-diff-value', cell: (r) => <span className="assign-after">{richText(r.after)}</span> },
            ]}
          />
        ) : null
      }
      actions={
        open ? (
          <>
            {p.command && p.input && (
              <Button className="btn btn--accent" onPress={onApply} isDisabled={busy}>
                Apply<span className="sr-only"> {p.title}</span>
              </Button>
            )}
            <Button className="btn btn--quiet" onPress={onDismiss} isDisabled={busy}>
              Dismiss<span className="sr-only"> {p.title}</span>
            </Button>
          </>
        ) : null
      }
    >
      {p.outcome && writesOff ? (
        <>
          <p className="failure" role="status" data-writes-off="">
            {writesOff}
          </p>
          <details className="proposal-command" data-outcome-details="">
            <summary>
              <SummaryChevron />
              Details
            </summary>
            <p className="note">What toil said, {dateTime(p.outcome.at)}:</p>
            <pre className="command">
              <code>{p.outcome.message}</code>
            </pre>
          </details>
        </>
      ) : (
        p.outcome && (
          <p className={p.outcome.ok ? 'note' : 'failure'} role="status">
            {dateTime(p.outcome.at)}: {p.outcome.message}
          </p>
        )
      )}
    </ProposalCard>
  );
}

/** A field by its plain name where one is known, with the tracker's own id one hover away; the id itself where none is. */
function FieldName({ field, name }: { field: string; name: string | null }) {
  return name ? <span title={`In the tracker: ${field}`}>{name}</span> : <code>{field}</code>;
}
