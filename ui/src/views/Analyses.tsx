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
import { segments } from '../agent.ts';
import { Card } from '../components/layout.tsx';
import { Help } from '../components/help.tsx';
import { ProposalCard } from '../components/proposal.tsx';
import { UsageFooter } from '../components/usage.tsx';
import { useData } from '../data.ts';
import { analysesHref, analysisHref, dateTime, shortKey, toilProjectHref } from '../format.ts';
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
      {running && <p className="note">A briefing is being written now; it joins the list when its answer is whole.</p>}
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

/** A recommendation as plain words: each citation as the item's key, so the headline can be one link and hold no other. */
function PlainCited({ text }: { text: string }) {
  const { byId } = useData();
  return (
    <>
      {segments(text).map((s, i) => {
        if ('cite' in s) {
          const item = byId.get(s.cite);
          return <span key={i}>{item ? shortKey(item) : s.cite}</span>;
        }
        return <span key={i}>{'text' in s ? s.text : ''}</span>;
      })}
    </>
  );
}

function AnalysisEntry({ a }: { a: AnalysisSummary }) {
  const { toilProject } = useData();
  const href = analysisHref(toilProject.name, a.id);
  const compared = a.changes.previous !== null && a.changes.previous !== undefined;
  return (
    <li className="analysis" data-analysis={a.id}>
      <p className="analysis__rec">
        <a href={href} data-analysis-open="">
          {a.recommendation ? <PlainCited text={a.recommendation} /> : `Briefing of ${dateTime(a.at)}`}
        </a>
        {compared && unchanged(a.changes) && <span className="analysis__tag">No change</span>}
      </p>
      <p className="note analysis__meta">
        <time dateTime={a.at}>{dateTime(a.at)}</time> · {whoText(a)} · cites {a.citations.length} {a.citations.length === 1 ? 'item' : 'items'}
        {a.unverified ? ` · ${a.unverified} its tools never returned` : ''}
      </p>
      {compared && !unchanged(a.changes) && (
        <details className="analysis__changes">
          <summary>{changesLine(a.changes)}</summary>
          <ChangesDetail changes={a.changes} />
        </details>
      )}
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
      (e: unknown) => live && setError(`The briefing didn't load: ${e instanceof Error ? e.message : String(e)}`),
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
