/**
 * The Charts tab (#567): a list of dashboards, each a quiet card with its one
 * headline in a sentence, and the dashboard a card opens. The headline is worked
 * out from the same data as the dashboard it opens, so the card can't say one
 * thing and the page another. A headline that can't be known is a dash with its
 * reason, never 0 (principle 12). A dashboard is a module (charts/dashboard.ts);
 * this file knows none of them by name. It is, in effect, the lobby, and has
 * the lobby's one virtue of not having opinions about the offices.
 */

import { useEffect } from 'react';
import { takeSaved } from './charts/saved.ts';
import { Card, CardGrid } from '../components/layout.tsx';
import { Help } from '../components/help.tsx';
import { Unread } from '../components/unread.tsx';
import { useData } from '../data.ts';
import { chartsHref } from '../format.ts';
import { useWorkInsights } from '../insights-data.ts';
import { useWords } from '../theme-context.ts';
import { exploreHref, viewSentence, viewSpec } from '../model/explore.ts';
import type { SavedView } from '../../../src/core/insights/index.ts';
import { DASHBOARDS, dashboardNamed } from './charts/index.ts';
import './charts/charts.css';

/** A view the team saved: a card that opens Explore on it. Removing one is a delete, which a person does in a terminal. */
function SavedCard({ name, view }: { name: string; view: SavedView }) {
  const { toilProject } = useData();
  const title = view.title ?? name;
  return (
    <li>
      <Card as="article" className="chart-card" aria-labelledby={`chart-saved-${name}`} data-saved-view={name}>
        <h2 id={`chart-saved-${name}`}>
          <a href={exploreHref(chartsHref(toilProject.name, 'explore'), viewSpec(view), view.chart)}>{title}</a>
        </h2>
        <p className="chart-card__headline">{viewSentence(viewSpec(view))}</p>
      </Card>
    </li>
  );
}

export function Charts({ dashboard }: { dashboard?: string | null }) {
  const { toilProject, refresh } = useData();
  const ins = useWorkInsights();
  const words = useWords();
  // A view saved in Explore is in the file, not yet in this page's copy: read the toil project again when the list opens.
  useEffect(() => {
    if (!dashboard && takeSaved()) refresh?.();
  }, [dashboard, refresh]);
  const found = dashboard ? dashboardNamed(dashboard) : undefined;
  if (found) return <found.View />;
  return (
    <section className="charts" aria-labelledby="charts-title">
      <h1 id="charts-title" tabIndex={-1}>
        {words('charts.eyebrow')} <Help topic="charts" />
      </h1>
      {dashboard && (
        <p className="note" role="alert" data-charts-missing="">
          There is no chart called “{dashboard}”. These are the ones there are.
        </p>
      )}
      <CardGrid min="md" className="charts-cards">
        {DASHBOARDS.map((d) => {
          const h = d.headline(ins);
          return (
            <li key={d.id}>
              <Card as="article" className="chart-card" aria-labelledby={`chart-card-${d.id}`} data-chart-card={d.id}>
                <h2 id={`chart-card-${d.id}`}>
                  <a href={chartsHref(toilProject.name, d.id)}>{d.title}</a>
                </h2>
                <p className="chart-card__headline">{h.text ?? <Unread />}</p>
                <p className="note chart-card__note">{h.note}</p>
              </Card>
            </li>
          );
        })}
      </CardGrid>
      {Object.keys(toilProject.views ?? {}).length > 0 && (
        <section aria-labelledby="charts-saved" className="charts-saved">
          <h2 id="charts-saved">{words('charts.saved')}</h2>
          <CardGrid min="md" className="charts-cards">
            {Object.entries(toilProject.views ?? {}).map(([name, view]) => (
              <SavedCard key={name} name={name} view={view} />
            ))}
          </CardGrid>
        </section>
      )}
    </section>
  );
}
