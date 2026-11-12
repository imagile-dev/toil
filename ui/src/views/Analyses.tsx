/**
 * Earlier briefings (#394, #395), a step in from the Summary's briefing at `…/summary/briefings` (the Past briefings tab is
 * gone, #567; the Summary holds the current one and Get a briefing): every Analyze kept for the toil project, newest
 * first, each with when it was made, the adapter and model that wrote it,
 * its one-line recommendation, and what changed since the one before (new
 * blockers, cleared ones, points moved, items newly cited or dropped),
 * worked out by code from a snapshot of the toil project each one kept. Any of
 * them opens again at its own address, laid out top-down like the chat's.
 * They are kept by the server in its cache, so they outlast a reload and a
 * restart, and `toil-ui wipe` takes them with the rest. Minutes of the
 * meeting, filed, with a diff.
 */

import { useEffect, useState } from 'react';
import { Breadcrumb } from '../components/breadcrumb.tsx';
import { AnalysisBody, ChangesDetail, changesLine, whoText } from '../components/analysis.tsx';
import { Cited } from '../components/items.tsx';
import { Card } from '../components/layout.tsx';
import { Help } from '../components/help.tsx';
import { ProposalCard } from '../components/proposal.tsx';
import { UsageFooter } from '../components/usage.tsx';
import { useData } from '../data.ts';
import { analysesHref, analysisHref, dateTime, toilProjectHref } from '../format.ts';
import { Empty, EmptyLink } from '../components/empty.tsx';
import { useChatScope } from '../components/ask.tsx';
import { unchanged, type AnalysisSummary, type AnalysisView } from '../model/analysis.ts';
import { Loader } from '../moments/Moments.tsx';
import { useWords } from '../skins.tsx';
import { usePlain } from '../plain-words.ts';

export function Analyses({ open }: { open?: string } = {}) {
  return <div className="tab-panels">{open ? <OpenAnalysis id={open} /> : <AnalysisList />}</div>;
}

function AnalysisList() {
  const chat = useChatScope();
  const running = chat?.turns.find((t) => t.analyze && !t.done);
  const history = chat?.history;
  const list = history?.list ?? null;
  const words = useWords();
  const plain = usePlain();
  const { toilProject } = useData();
  return (
    <Card as="section" className="panel analyses" aria-labelledby="analyses-title">
      <Breadcrumb trail={[{ label: 'Summary', href: toilProjectHref(toilProject.name) }, { label: plain.pw('Earlier analyses', 'Earlier briefings') }]} />
      <h1 id="analyses-title" tabIndex={-1}>
        {plain.pw('Earlier analyses', 'Earlier briefings')} <Help topic="analyses" />
      </h1>
      <p className="note">
        {plain.pw('Every Analyze kept for', 'Every briefing kept for')} {toilProject.name}, newest first. The newest is the one on the Summary.
        {running && ' A briefing is being written now; it joins the list when its answer is whole.'}
      </p>
      {history?.error && <p className="failure">{history.error}</p>}
      {list === null ? (
        !history?.error && <Loader size="panel" message={words('loading.briefings')} />
      ) : list.length ? (
        <ol className="analyses__list" aria-label="Briefings, newest first">
          {list.map((a) => (
            <AnalysisEntry key={a.id} a={a} />
          ))}
        </ol>
      ) : running ? null : (
        <Empty message={words('empty.briefings')} action={<EmptyLink href={toilProjectHref(toilProject.name)}>{plain.pw('Open the Summary to run Analyze', 'Open the Summary to get a briefing')}</EmptyLink>} />
      )}
    </Card>
  );
}

function AnalysisEntry({ a }: { a: AnalysisSummary }) {
  const { toilProject } = useData();
  return (
    <li className="analysis" data-analysis={a.id}>
      <p className="note analysis__meta">
        <time dateTime={a.at}>{dateTime(a.at)}</time>, by {whoText(a)}. Cites {a.citations.length} {a.citations.length === 1 ? 'item' : 'items'}
        {a.unverified ? `, ${a.unverified} its tools never returned` : ''}.
      </p>
      <p className="analysis__rec">{a.recommendation ? <Cited text={a.recommendation} chips /> : <span className="note">This answer had no Recommendation line; open it to read it as it came.</span>}</p>
      {a.changes.previous && !unchanged(a.changes) ? (
        <details className="analysis__changes">
          <summary>{changesLine(a.changes)}</summary>
          <ChangesDetail changes={a.changes} />
        </details>
      ) : (
        <p className="note analysis__changes">{changesLine(a.changes)}</p>
      )}
      <p className="analysis__open">
        <a href={analysisHref(toilProject.name, a.id)}>
          Open<span className="sr-only"> the analysis of {dateTime(a.at)}</span>
        </a>
      </p>
    </li>
  );
}

function OpenAnalysis({ id }: { id: string }) {
  const { analyses, toilProject } = useData();
  const words = useWords();
  const plain = usePlain();
  const [view, setView] = useState<AnalysisView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    setView(undefined);
    if (!analyses) return void setView(null);
    analyses.get(toilProject.name, id).then(
      (v) => live && setView(v),
      (e: unknown) => live && setError(`The analysis didn't load: ${e instanceof Error ? e.message : String(e)}`),
    );
    return () => {
      live = false;
    };
  }, [analyses, toilProject.name, id]);
  const earlier = plain.pw('Earlier analyses', 'Earlier briefings');
  const back = (title: string) => <Breadcrumb trail={[{ label: 'Summary', href: toilProjectHref(toilProject.name) }, { label: earlier, href: analysesHref(toilProject.name) }, { label: title }]} />;
  if (error || view === null) {
    return (
      <Card as="section" className="panel analyses" aria-labelledby="analysis-title">
        {back('Not found')}
        <h1 id="analysis-title" tabIndex={-1}>Briefing not found</h1>
        <p className={error ? 'failure' : undefined}>{error ?? `${toilProject.name} has no briefing by that id: it may have passed the cache's retention period, or the cache was wiped.`}</p>
      </Card>
    );
  }
  if (!view) return <p className="note">{words('loading.analysis')}</p>;
  const { record: r, changes } = view;
  const title = `Briefing of ${dateTime(r.at)}`;
  return (
    <Card as="section" className="panel analyses analysis-open" aria-labelledby="analysis-title">
      {back(title)}
      <h1 id="analysis-title" tabIndex={-1}>{title}</h1>
      <p className="note">
        Asked {dateTime(r.startedAt)}, answered by {whoText(r)}. Cites {r.citations.length} {r.citations.length === 1 ? 'item' : 'items'}.
      </p>
      {r.warnings.length > 0 && (
        <div className="answer-checks" aria-label="Checks on this answer">
          {r.warnings.map((w, i) => (
            <p key={i} className="failure">
              {w}
            </p>
          ))}
        </div>
      )}
      <AnalysisBody parts={r.parts} briefing={r.briefing} level={2} />
      {r.proposals.length > 0 && (
        <section aria-labelledby="analysis-proposals">
          <h2 id="analysis-proposals">Suggested changes</h2>
          {r.proposals
            .filter((p) => !dismissed.has(p.id))
            .map((p) => (
              <ProposalCard key={p.id} proposal={p} onDismiss={() => setDismissed((d) => new Set(d).add(p.id))} />
            ))}
        </section>
      )}
      <section aria-labelledby="analysis-changes">
        <h2 id="analysis-changes">What changed since the one before</h2>
        <ChangesDetail changes={changes} />
      </section>
      {r.usage && <UsageFooter usage={r.usage} />}
    </Card>
  );
}
