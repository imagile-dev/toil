/**
 * Where Toil UI opens: every dossier toil can see (`toil dossiers list`), each
 * with what it covers (`toil dossiers show`), and a link to its dashboard. A
 * dossier is one body of work, so this is the list of things someone might
 * be asked about in a meeting, which is a shorter list than the org chart.
 */

import { Card, CardGrid } from '../components/layout.tsx';
import { Sources } from '../components/panel.tsx';
import { SOURCE_LABEL, dossierHref } from '../format.ts';
import type { DossierSummary } from '../load.ts';
import { useSkins } from '../skins.tsx';
import type { Call, SourceKind } from '../toil.ts';

export function Dossiers({ dossiers, calls }: { dossiers: DossierSummary[]; calls: Call[] }) {
  const { EmptyState } = useSkins();
  return (
    <>
      <div className="view-head">
        <h1 tabIndex={-1}>Dossiers</h1>
        <p className="lede">Each dossier is one body of work: its repositories, its tracker, its pipelines and its environments. Pick one to see its stories, pull requests, builds and deployments together.</p>
      </div>
      {dossiers.length === 0 ? (
        <EmptyState message="toil sees no dossiers yet. A dossier is made with toil dossiers init." />
      ) : (
        <CardGrid className="dossiers">
          {dossiers.map((d) => (
            <li key={d.name}>
              <Card className="dossier-card" aria-labelledby={`dossier-${d.name}`}>
                <h2 id={`dossier-${d.name}`}>
                  <a href={dossierHref(d.name)}>{d.name}</a>
                </h2>
                {d.description && <p>{d.description}</p>}
                <dl className="facts">
                  <div>
                    <dt>Sources</dt>
                    <dd>{d.sources.map((s) => SOURCE_LABEL[s.area as SourceKind] ?? s.area).join(', ')}</dd>
                  </div>
                  <div>
                    <dt>Environments</dt>
                    <dd>{d.environments.length ? d.environments.join(', ') : 'None named'}</dd>
                  </div>
                </dl>
              </Card>
            </li>
          ))}
        </CardGrid>
      )}
      <Sources calls={calls} />
    </>
  );
}
