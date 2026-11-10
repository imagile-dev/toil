/**
 * The Charts tab (#567): a list of dashboards, each a quiet card with its one
 * headline in a sentence, and the dashboard a card opens. The headline is worked
 * out from the same data as the dashboard it opens, so the card can't say one
 * thing and the page another. A headline that can't be known is a dash with its
 * reason, never 0 (principle 12). A dashboard is a module (charts/dashboard.ts);
 * this file knows none of them by name. It is, in effect, the lobby, and has
 * the lobby's one virtue of not having opinions about the offices.
 */

import { Card, CardGrid } from '../components/layout.tsx';
import { Help } from '../components/help.tsx';
import { Unread } from '../components/unread.tsx';
import { useData } from '../data.ts';
import { chartsHref } from '../format.ts';
import { useWorkInsights } from '../insights-data.ts';
import { useWords } from '../theme-context.ts';
import { DASHBOARDS, dashboardNamed } from './charts/index.ts';
import './charts/charts.css';

export function Charts({ dashboard }: { dashboard?: string | null }) {
  const { toilProject } = useData();
  const ins = useWorkInsights();
  const words = useWords();
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
    </section>
  );
}
