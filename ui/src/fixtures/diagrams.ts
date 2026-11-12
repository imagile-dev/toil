/**
 * The preview's stored architecture diagrams (#582): one C4 model for each
 * sample toil project, as `toil projects diagram show` would print it from
 * `~/.toil/diagrams/<name>.json`, and the computed views that go with it.
 *
 * The models are plain data, written by hand: some things read from a file
 * and line (`observed`, with its `source`), some concluded (`inferred`, with
 * its `reason`), and a few that say nothing, so the legend's third kind has
 * something to show. No host, no address and no secret is in any of them,
 * which is also what toil's own storage checks insist on.
 *
 * The computed views (`diagram-views.ts`) are what toil's `computeView` makes
 * of these models. The page does not load that function (it comes with zod),
 * so they are committed, and `test/registry.test.ts` runs the real `projects
 * diagram show` on each model and holds both files to what it prints. Change a
 * model and that test says which file to refresh and how. Three diagrams, each
 * signed off by a reviewer who will never read them.
 */

import type { ComputedView } from '../../../src/areas/util/c4/view.ts';
import { SAMPLE_VIEWS } from './diagram-views.ts';

type How = 'observed' | 'inferred';
interface Known {
  how?: How;
  source?: string;
  reason?: string;
}
interface Thing extends Known {
  id: string;
  name: string;
  description?: string;
  technology?: string;
  external?: boolean;
}
export interface SampleModel {
  title: string;
  people: Thing[];
  systems: Array<Thing & { containers?: Array<Thing & { database?: boolean }> }>;
  relationships: Array<{ source: string; destination: string; description?: string; technology?: string; how?: How; evidence?: string; reason?: string }>;
  views: Array<{ key: string; type: 'systemContext' | 'container' | 'component'; scope: string; title: string }>;
}

export interface SampleDiagram {
  revision: number;
  savedAt: string;
  model: SampleModel;
  notMapped: string[];
}

const CARD: SampleModel = {
  title: 'Card payments',
  people: [
    { id: 'cardholder', name: 'Cardholder', description: 'Pays with a card at a merchant.', how: 'observed', source: 'payments-core/README.md:9' },
    { id: 'support', name: 'Support agent', description: 'Looks up a payment to answer a dispute.', how: 'inferred', reason: 'the API has a lookup route that only an internal role may call' },
  ],
  systems: [
    {
      id: 'payments',
      name: 'Card payments',
      description: 'Takes a card payment and settles it.',
      how: 'observed',
      source: 'payments-core/README.md:1',
      containers: [
        { id: 'api', name: 'Payments API', description: 'Accepts and looks up payments.', technology: 'Java, Spring Boot', how: 'observed', source: 'payments-core/pom.xml:14' },
        { id: 'tokeniser', name: 'Tokeniser', description: 'Swaps a card number for a token at the edge.', technology: 'Java', how: 'observed', source: 'payments-core/tokeniser/pom.xml:9' },
        { id: 'worker', name: 'Settlement worker', description: 'Sends authorised payments to the card network.', technology: 'Java', how: 'inferred', reason: 'its main class reads the settlements topic, but no manifest names it as a service' },
        { id: 'db', name: 'Payments database', description: 'Payments and their state.', technology: 'PostgreSQL', database: true, how: 'observed', source: 'payments-core/src/main/resources/application.yml:22' },
        { id: 'cache', name: 'Token cache', description: 'Recently used tokens.', technology: 'Redis', how: 'inferred', reason: 'a cache client is configured, but nothing here says who runs it' },
      ],
    },
    { id: 'network', name: 'Card network', description: 'Authorises and clears card payments.', external: true, how: 'inferred', reason: 'the worker names a scheme client; the network itself is outside this repository' },
    { id: 'ledger', name: 'General ledger', description: 'Where finance books settled payments.', external: true },
  ],
  relationships: [
    { source: 'cardholder', destination: 'api', description: 'Pays through', technology: 'JSON/HTTPS', how: 'observed', evidence: 'payments-core/openapi/payments.yaml:3' },
    { source: 'support', destination: 'api', description: 'Looks up payments in', how: 'inferred', reason: 'the lookup route is documented for support' },
    { source: 'api', destination: 'tokeniser', description: 'Swaps card numbers with', how: 'observed', evidence: 'payments-core/src/main/java/pay/api/CardClient.java:31' },
    { source: 'tokeniser', destination: 'cache', description: 'Keeps recent tokens in', how: 'inferred', reason: 'the tokeniser configures a cache client' },
    { source: 'api', destination: 'db', description: 'Reads and writes', technology: 'JDBC', how: 'observed', evidence: 'payments-core/src/main/resources/application.yml:22' },
    { source: 'worker', destination: 'db', description: 'Reads authorised payments from', technology: 'JDBC', how: 'observed', evidence: 'payments-core/worker/src/main/java/pay/worker/Poller.java:18' },
    { source: 'worker', destination: 'network', description: 'Sends settlements to', how: 'inferred', reason: 'the worker builds scheme messages; the destination is not in the repository' },
    { source: 'worker', destination: 'ledger', description: 'Posts settled totals to' },
  ],
  views: [
    { key: 'context', type: 'systemContext', scope: 'payments', title: 'Card payments in context' },
    { key: 'containers', type: 'container', scope: 'payments', title: 'Card payments, containers' },
  ],
};

const SETTLEMENT: SampleModel = {
  title: 'Settlement',
  people: [{ id: 'analyst', name: 'Finance analyst', description: 'Reads the daily settlement report.', how: 'observed', source: 'settlement/docs/runbook.md:4' }],
  systems: [
    {
      id: 'settlement',
      name: 'Settlement',
      description: 'Builds the daily settlement reports.',
      how: 'observed',
      source: 'settlement/README.md:1',
      containers: [
        { id: 'batch', name: 'Settlement batch', description: 'Runs nightly and builds the day.', technology: '.NET', how: 'observed', source: 'settlement/Settlement.Batch/Settlement.Batch.csproj:3' },
        { id: 'reports', name: 'Report service', description: 'Serves the finished reports.', technology: '.NET, ASP.NET Core', how: 'observed', source: 'settlement/Settlement.Reports/Settlement.Reports.csproj:3' },
        { id: 'store', name: 'Settlement database', description: 'Settled payments and report runs.', technology: 'SQL Server', database: true, how: 'observed', source: 'settlement/Settlement.Batch/appsettings.json:6' },
      ],
    },
    { id: 'bankfiles', name: 'Bank file drop', description: 'Where the bank leaves its statements.', external: true, how: 'inferred', reason: 'the batch job reads a folder named for the bank; who writes it is not in the repository' },
  ],
  relationships: [
    { source: 'analyst', destination: 'reports', description: 'Reads reports from', how: 'observed', evidence: 'settlement/docs/runbook.md:12' },
    { source: 'batch', destination: 'bankfiles', description: 'Reads statements from', how: 'inferred', reason: 'the batch job opens a statements folder' },
    { source: 'batch', destination: 'store', description: 'Writes settled days to', technology: 'SQL', how: 'observed', evidence: 'settlement/Settlement.Batch/DayWriter.cs:40' },
    { source: 'reports', destination: 'store', description: 'Reads reports from', technology: 'SQL', how: 'observed', evidence: 'settlement/Settlement.Reports/ReportQuery.cs:22' },
  ],
  views: [
    { key: 'context', type: 'systemContext', scope: 'settlement', title: 'Settlement in context' },
    { key: 'containers', type: 'container', scope: 'settlement', title: 'Settlement, containers' },
  ],
};

const CHECKOUT: SampleModel = {
  title: 'Checkout web',
  people: [{ id: 'shopper', name: 'Shopper', description: 'Buys something and pays.', how: 'observed', source: 'payments-web/README.md:5' }],
  systems: [
    {
      id: 'checkout',
      name: 'Checkout',
      description: 'The checkout page and the SDK behind it.',
      how: 'observed',
      source: 'payments-web/package.json:2',
      containers: [
        { id: 'web', name: 'Checkout web', description: 'The page a shopper pays on.', technology: 'React, TypeScript', how: 'observed', source: 'payments-web/package.json:14' },
        { id: 'sdk', name: 'Checkout SDK', description: 'Talks to payments for the page.', technology: 'TypeScript', how: 'observed', source: 'checkout-sdk/package.json:2' },
        { id: 'session', name: 'Session store', description: 'A shopper’s basket while they pay.', technology: 'Redis', database: true, how: 'inferred', reason: 'the page server configures a session store; nothing names the engine except its client package' },
      ],
    },
    { id: 'paymentsapi', name: 'Payments', description: 'Takes the card payment.', external: true, how: 'observed', source: 'checkout-sdk/src/client.ts:12' },
  ],
  relationships: [
    { source: 'shopper', destination: 'web', description: 'Pays on', how: 'observed', evidence: 'payments-web/README.md:5' },
    { source: 'web', destination: 'sdk', description: 'Calls', how: 'observed', evidence: 'payments-web/src/pay.ts:3' },
    { source: 'web', destination: 'session', description: 'Keeps the basket in', how: 'inferred', reason: 'the page server reads and writes a session' },
    { source: 'sdk', destination: 'paymentsapi', description: 'Pays through', technology: 'JSON/HTTPS', how: 'observed', evidence: 'checkout-sdk/src/client.ts:12' },
  ],
  views: [
    { key: 'context', type: 'systemContext', scope: 'checkout', title: 'Checkout in context' },
    { key: 'containers', type: 'container', scope: 'checkout', title: 'Checkout, containers' },
  ],
};

/** When each sample diagram was saved: the moment the sample was read, so its age reads as the two hours the preview's page adds. */
const SAVED = '2026-10-13T08:00:00.000Z';

export const SAMPLE_DIAGRAMS: Record<string, SampleDiagram> = {
  'card-payments': { revision: 2, savedAt: SAVED, model: CARD, notMapped: ['dist/', 'node_modules/', 'payments-core/vendor/'] },
  settlement: { revision: 1, savedAt: SAVED, model: SETTLEMENT, notMapped: ['bin/', 'obj/'] },
  'checkout-web': { revision: 1, savedAt: SAVED, model: CHECKOUT, notMapped: ['dist/', 'node_modules/'] },
};

/** The file the preview says holds a diagram, as `projects diagram show` reports it. */
export const diagramFile = (name: string) => `/home/you/.toil/diagrams/${name}.json`;

/** What `toil projects diagram show` counts: every element and every relationship once, by how it is known. */
export function countsOf(model: SampleModel) {
  const things: Known[] = [...model.people, ...model.systems, ...model.systems.flatMap((s) => s.containers ?? [])];
  const all: Known[] = [...things, ...model.relationships];
  const tally = (how: How | undefined) => all.filter((x) => x.how === how).length;
  return { elements: things.length, relationships: model.relationships.length, observed: tally('observed'), inferred: tally('inferred'), unmarked: tally(undefined) };
}

/** `projects diagram show <name>`'s data, with one view computed when `view` names it. */
export function diagramShow(name: string, view?: string) {
  const d = SAMPLE_DIAGRAMS[name]!;
  const computed: ComputedView | undefined = view === undefined ? undefined : SAMPLE_VIEWS[name]?.[view];
  return {
    toilProject: name,
    revision: d.revision,
    savedAt: d.savedAt,
    toilVersion: '0.1.0-beta.5',
    file: diagramFile(name),
    model: d.model,
    notMapped: d.notMapped,
    views: d.model.views.map((v) => ({ key: v.key, type: v.type, title: v.title })),
    counts: countsOf(d.model),
    ...(computed ? { view: computed } : {}),
  };
}
