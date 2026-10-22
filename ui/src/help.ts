/**
 * The help topics (#346): every (i) in Toil UI and every Read more link it
 * opens, defined once. A topic is one or two sentences and the exact docs
 * section that says the rest, on the site: `/docs/` for toil's own concepts
 * (connections, dossiers, writes, the audit log) and `/docs/ui/` and
 * `/docs/themes/` for the app. `ui/test/help.test.tsx`
 * resolves every link against the docs' own headings, and the site build
 * checks each one again against the pages it built
 * (`site/scripts/check-help-links.mjs`), so a renamed heading fails a build
 * rather than a reader. Plain data with no imports, so the site's build
 * script can read it as it is.
 * Every form now comes with its own guidance notes, filed separately, as is customary.
 */

/** Where the docs live. A Read more link is the one link out of the app, and a person follows it. */
export const DOCS_SITE = 'https://imagile-dev.github.io/toil';

/** The docs pages a topic may point at; the tests map each one to the file it renders. */
export type DocsPage = '/docs/ui/' | '/docs/themes/' | '/docs/core/' | '/docs/dossiers/';

export interface HelpTopic {
  /** What the (i) is about: its accessible name is "About <title>", and its popover's heading. */
  title: string;
  /** One or two sentences, shown in the tooltip and the popover. */
  text: string;
  page: DocsPage;
  /** The heading's id on that page, as the site's build makes it. */
  anchor: string;
}

export const HELP = {
  dossiers: { title: 'dossiers', text: 'A dossier names the repositories, tracker, pipelines and environments of one body of work. Each card is read from the cache a sync filled, so opening this page asks no tracker anything.', page: '/docs/ui/', anchor: 'the-dossiers-view' },
  dashboard: { title: 'this dashboard', text: "Every panel is read through toil, read-only, and says which commands fed it. A call that failed shows on its own panel with toil's message and fix.", page: '/docs/ui/', anchor: 'what-it-reads' },
  recommendation: { title: 'the recommendation', text: "The latest Analyze's recommendation when the dossier has one, with when it was made. Without one it is worked out by code, with no agent call, from the blockers, builds, pull requests, aging work, readiness and the sprint's pace, and the card says which.", page: '/docs/ui/', anchor: 'the-overview' },
  insights: { title: 'insights', text: 'An insight is something about an item that deserves a look, such as Blocked, Stale or Build failing, weightiest first. Each one names the field, history or command it rests on.', page: '/docs/ui/', anchor: 'insights' },
  prs: { title: 'pull requests', text: "Read from every code host the dossier names, the open ones ranked by how long each has waited and on what. Flow figures are the team's, never one person's.", page: '/docs/ui/', anchor: 'pull-requests' },
  people: { title: 'the People view', text: "What is on each person's plate, from the dossier's people section and the same items and pull requests as the dashboard. It never ranks or scores anyone.", page: '/docs/ui/', anchor: 'people' },
  readiness: { title: 'the Command Center', text: 'Each verdict is worked out from the cached records, with no model call and no live read. Only ready items are slated, in the dossier\'s order.', page: '/docs/ui/', anchor: 'readiness-and-the-command-center' },
  worklog: { title: 'the worklog', text: "One page a day, folded by code from the sync, the pull requests, the builds and the agent's runs: facts only, each line linked to where it came from. Days and times are UTC.", page: '/docs/ui/', anchor: 'worklog' },
  standup: { title: 'the stand-up', text: 'Built by code from the worklog\'s days, facts only, so the same days always give the same report. Days and times are UTC.', page: '/docs/ui/', anchor: 'stand-up' },
  proposal: { title: 'the write gate', text: "Nothing changes until you run the command yourself. toil's write gate then needs writes on for the connection and --allow-write on the call.", page: '/docs/core/', anchor: 'writes' },
  settings: { title: "toil's configuration", text: "Changes run toil's own connections and dossiers commands, never an edit to a file, and each is in toil's audit log as toil-ui. Nothing here writes to a tracker.", page: '/docs/ui/', anchor: 'toils-configuration' },
  connections: { title: 'connections', text: 'A connection is one instance of an area: its host, its credential and whether writes are on. toil connections list never returns a secret, which stays in the OS credential store.', page: '/docs/core/', anchor: 'configuration' },
  'dossier-setup': { title: 'dossier setup', text: "Each form runs one toil dossiers command, which checks the file before writing it and refuses to add what's already there unless you tick Replace. A dossier holds no secret and can't turn writes on.", page: '/docs/dossiers/', anchor: 'create-check-use-share' },
  'dossier-list': { title: 'where dossiers come from', text: 'Your own dossiers, any folders you listed, and the ones a repository checks in. Check finds problems without contacting any service.', page: '/docs/dossiers/', anchor: 'where-dossiers-live' },
  'repo-setup': { title: 'setting up a repo', text: 'For a repository with a dossier checked in: which of your connections each area would use, the ones still missing, and one test read through each. It changes nothing.', page: '/docs/dossiers/', anchor: 'onboarding-to-a-repo-that-has-a-dossier' },
  bounds: { title: 'bounds and the time limit', text: "toil has no command to change these, and Toil UI never edits toil's files, so they're shown as toil reports them. Only your own config file can relax a bound, and only the file workspace.", page: '/docs/core/', anchor: 'files-and-the-workspace' },
  audit: { title: 'usage of toil', text: "From toil audit stats, which reads only toil's audit log on this machine and sends it nowhere. It counts the command, how it was called and how it ended, never what a call was given or got back.", page: '/docs/core/', anchor: 'the-audit-log' },
  'audit-failures': { title: 'failures', text: "The log keeps each failure's error code, never its message, so the fix shown is the one that usually applies to that code.", page: '/docs/core/', anchor: 'the-audit-log' },
  'model-usage': { title: "the agent's usage", text: "Figures the Claude, Codex and Copilot SDKs reported, kept only in Toil UI's local cache and sent nowhere. A figure an SDK didn't report reads not reported; your vendor's bill is the authority.", page: '/docs/ui/', anchor: 'what-the-agents-models-used' },
  caps: { title: 'caps', text: 'At 80% the chat says so; at 100% the question stops, naming the cap. A cap counts only what the SDK reports, so it guards against a runaway and is not a budget.', page: '/docs/ui/', anchor: 'what-the-agents-models-used' },
  agent: { title: 'the agent', text: "The agent your organization already approved answers in the chat, on your own subscription, and only reads. These are Toil UI's own settings, kept in its data folder, never in toil's config.", page: '/docs/ui/', anchor: 'the-agent' },
  assignments: { title: 'assigning work to an agent', text: 'An assignment runs on your adapter, within your time limit and usage caps. Nothing it proposes leaves this machine until you apply it through toil\'s write gate.', page: '/docs/ui/', anchor: 'assigning-work-to-an-agent' },
  'themed-wording': { title: 'themed wording', text: "The theme's own lede, eyebrows, notes, empty states and loading lines, and its names for a sprint, a board or an epic beside the real ones. Buttons, links, figures, ids, commands and errors always read the same.", page: '/docs/themes/', anchor: 'visuals-wording-and-voice' },
  'themed-voice': { title: 'themed agent voice', text: "The agent answers in the theme's register. It changes phrasing only: citations, figures and proposals stay exact.", page: '/docs/themes/', anchor: 'the-checkboxes' },
  'first-run': { title: 'getting started', text: "Each step ticks itself off from toil's own state: a connection to a tracker (one made by env vars counts), a dossier, and a first sync. The list goes once the first sync finishes.", page: '/docs/ui/', anchor: 'first-run' },
  sync: { title: 'syncing', text: 'A sync reads every dossier through toil, read-only, and keeps what it read in a cache on this machine. Every view reads that cache, so opening one asks no tracker anything.', page: '/docs/ui/', anchor: 'sync-and-the-cache' },
  'sample-data': { title: 'the sample data', text: 'Sample dossiers and a scripted agent, with nothing connected to a tracker. Stop this Toil UI with Ctrl+C and start it again with this command to look around first.', page: '/docs/ui/', anchor: 'start-it' },
  palette: { title: 'the command palette', text: 'Jumps to a dossier, a tab, an item in any dossier, a saved analysis, a setting or a theme, and runs Sync, Analyze and Ask. Items are searched in the cache, never live.', page: '/docs/ui/', anchor: 'the-command-palette' },
  motion: { title: 'motion and effects', text: "Reduce motion stops the themes' animations and particles in this browser. Your system's reduced-motion setting stops them whichever way this is set.", page: '/docs/themes/', anchor: 'motion-and-particles' },
} as const satisfies Record<string, HelpTopic>;

export type HelpTopicId = keyof typeof HELP;

export const helpHref = (topic: HelpTopic): string => `${DOCS_SITE}${topic.page}#${topic.anchor}`;

/** The header's Help entry: the docs section for the view in front of you. */
export type HelpView = 'dossiers' | 'dashboard' | 'prs' | 'people' | 'command-center' | 'worklog' | 'standup' | 'item' | 'assignment' | 'settings';
const VIEW_TOPIC: Record<HelpView, HelpTopicId> = {
  dossiers: 'dossiers',
  dashboard: 'dashboard',
  prs: 'prs',
  people: 'people',
  'command-center': 'readiness',
  worklog: 'worklog',
  standup: 'standup',
  item: 'readiness',
  assignment: 'assignments',
  settings: 'settings',
};
/** Settings pages whose section isn't the settings overview. */
const SETTINGS_TOPIC: Record<string, HelpTopicId> = { 'agent-usage': 'model-usage', agent: 'agent', usage: 'audit', dossiers: 'dossier-setup', connections: 'connections' };

export function viewHelpHref(view: HelpView, settingsPage?: string): string {
  const id = view === 'settings' && settingsPage ? (SETTINGS_TOPIC[settingsPage] ?? 'settings') : VIEW_TOPIC[view];
  return helpHref(HELP[id]);
}
