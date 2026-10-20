/**
 * The app shell: the preview banner, the theme controls, the line every view
 * carries saying when and how its data was read, and the routes: the dossier
 * list, one dashboard per dossier, and an item page inside each. Each view's
 * data is loaded through `execute()` (src/load.ts) the first time it is
 * opened and kept for the session, so a view is a function of data and the
 * tests can render one against the fixture `execute()` directly. Navigation
 * is by hash, so any static host can serve it at any path without a rewrite
 * rule, which is one fewer change request.
 */

import { useEffect, useInsertionEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Popover } from 'react-aria-components';
import type { Agent } from './agent.ts';
import { Ambient } from './ambient/Ambient.tsx';
import { DataContext, type Data } from './data.ts';
import { dateTime, dossierHref, peopleHref, prsHref, worklogHref } from './format.ts';
import { loadDossier, loadDossiers, type DossierData, type DossierSummary } from './load.ts';
import { SkinProvider, ThemeProvider, skinsFor } from './skins.tsx';
import { THEMES, themeNamed, tokenCss } from './themes.ts';
import { useThemeChoice } from './theme-choice.ts';
import type { Call, Execute } from './toil.ts';
import { Dashboard } from './views/Dashboard.tsx';
import { Dossiers } from './views/Dossiers.tsx';
import { ItemView } from './views/Item.tsx';
import { People } from './views/People.tsx';
import { PullRequests } from './views/PullRequests.tsx';
import { Settings } from './views/Settings.tsx';
import { Worklog } from './views/Worklog.tsx';
import type { WorklogApi } from './worklog.ts';
import { isDay } from './model/worklog.ts';
import type { ConfigApi } from './config.ts';
import type { AgentSettingsPanelProps } from './agent-settings.tsx';
import type { ModelUsageApi } from './server-client.ts';
import type { FeedbackApi } from './feedback.ts';
import { FeedbackButton, FeedbackModal } from './feedback-dialog.tsx';
import { useMediaQuery } from './components/layout.tsx';
import { Choice } from './components/choice.tsx';
import { ThemeChoiceProvider, wordingOn } from './theme-context.ts';
import { wordFor, type WordKey } from './wording.ts';

export type SettingsPage = 'connections' | 'dossiers' | 'toil' | 'usage' | 'agent-usage' | 'agent';
export type Route =
  | { view: 'dossiers' }
  | { view: 'settings'; page: SettingsPage }
  /** `person`: the board filtered to one person, by the People view's key for them (#292). */
  | { view: 'dashboard'; dossier: string; person?: string }
  | { view: 'prs'; dossier: string }
  | { view: 'people'; dossier: string }
  | { view: 'worklog'; dossier: string; day: string | null }
  | { view: 'item'; dossier: string; id: string };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'settings') return { view: 'settings', page: parts[1] === 'dossiers' || parts[1] === 'toil' || parts[1] === 'usage' || parts[1] === 'agent-usage' || parts[1] === 'agent' ? parts[1] : 'connections' };
  if (parts[0] === 'dossier' && parts[1]) {
    const dossier = decodeURIComponent(parts[1]);
    if (parts[2] === 'item' && parts[3]) return { view: 'item', dossier, id: decodeURIComponent(parts.slice(3).join('/')) };
    if (parts[2] === 'prs') return { view: 'prs', dossier };
    if (parts[2] === 'people') return { view: 'people', dossier };
    if (parts[2] === 'board' && parts[3]) return { view: 'dashboard', dossier, person: decodeURIComponent(parts.slice(3).join('/')) };
    if (parts[2] === 'worklog') return { view: 'worklog', dossier, day: isDay(parts[3]) ? parts[3] : null };
    return { view: 'dashboard', dossier };
  }
  return { view: 'dossiers' };
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export interface AppProps {
  /** `execute()` from `@imagile-dev/toil/api`, or the preview's fixture one. */
  execute: Execute;
  agent: Agent;
  /** toil's config commands, for the settings pages: the server's, or the preview's sample one, which changes nothing. */
  config?: ConfigApi;
  /** When the data is read; sprint figures are worked out at it. The preview's is fixed. */
  now: string;
  /** The site preview: shows the unreleased-product banner on every view. */
  preview: boolean;
  /** The local app's agent settings (#251), shown under Settings; the preview has none. */
  agentSettings?: AgentSettingsPanelProps;
  /** `toil feedback`, behind the header's Feedback button (#265): the server's, or the preview's, which sends nothing. */
  feedback?: FeedbackApi;
  /** The worklog (#308): the server's pages, or the sample's, which keep nothing. */
  worklog?: WorklogApi;
  /** The agent's model usage and caps (#295), for Settings, Agent usage: the server's, or the preview's sample. */
  modelUsage?: ModelUsageApi;
}

type Loaded<T> = { ok: true; value: T } | { ok: false; message: string };
const failed = (e: unknown): Loaded<never> => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

export function App({ execute, agent, config, now, preview, agentSettings, feedback, modelUsage, worklog }: AppProps) {
  const route = useRoute();
  const [list, setList] = useState<Loaded<{ dossiers: DossierSummary[]; calls: Call[] }> | null>(null);
  const [dossiers, setDossiers] = useState<Record<string, Loaded<DossierData>>>({});
  const choice = useThemeChoice();
  const theme = themeNamed(choice.theme);
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  const wanted = route.view === 'dossiers' || route.view === 'settings' ? null : route.dossier;

  useEffect(() => {
    if (route.view !== 'dossiers' || list) return;
    let live = true;
    loadDossiers(execute).then(
      (value) => live && setList({ ok: true, value }),
      (e: unknown) => live && setList(failed(e)),
    );
    return () => {
      live = false;
    };
  }, [route.view, list, execute]);

  useEffect(() => {
    if (!wanted || dossiers[wanted]) return;
    let live = true;
    loadDossier(execute, wanted).then(
      (value) => live && setDossiers((d) => ({ ...d, [wanted]: { ok: true, value } })),
      (e: unknown) => live && setDossiers((d) => ({ ...d, [wanted]: failed(e) })),
    );
    return () => {
      live = false;
    };
  }, [wanted, dossiers, execute]);

  // A new view moves focus to its heading, so a screen reader hears where it
  // landed and the next Tab starts from the top of the content. A dashboard
  // still loading has no heading yet, so the move waits until it renders one.
  const routeKey = JSON.stringify(route);
  const pending = useRef(false);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    pending.current = true;
  }, [routeKey]);
  useEffect(() => {
    // A board filtered to one person (#292) takes focus at the filter's line instead, which is what the link was for.
    const h1 = pending.current ? (main.current?.querySelector<HTMLElement>('#board-filter') ?? main.current?.querySelector<HTMLElement>('h1')) : null;
    if (h1) {
      pending.current = false;
      h1.focus();
    }
  });

  const skip = (e: MouseEvent) => {
    e.preventDefault();
    main.current?.querySelector<HTMLElement>('h1')?.focus();
  };

  const skins = skinsFor(theme.name);
  // The App provides the theme context, so it can't read it through useWords(); this is the same lookup.
  const words = (key: WordKey, vars?: Record<string, string>) => wordFor(theme.lexicon, wordingOn(theme, choice), key, vars);
  const compact = useMediaQuery(COMPACT_HEADER);
  const links: NavLink[] = [
    { href: '#/', label: 'Dossiers', current: route.view === 'dossiers' },
    ...(wanted
      ? [
          { href: dossierHref(wanted), label: wanted, current: route.view === 'dashboard' },
          { href: prsHref(wanted), label: 'Pull requests', current: route.view === 'prs' },
          { href: peopleHref(wanted), label: 'People', current: route.view === 'people' },
          { href: worklogHref(wanted), label: 'Worklog', current: route.view === 'worklog' },
        ]
      : []),
    { href: '#/settings', label: 'Settings', current: route.view === 'settings' },
  ];
  const controls = (
    <>
      <Choice label="Theme" value={theme.name} onChange={choice.setTheme} options={THEMES.map((t) => ({ id: t.name, label: t.label }))} />
      {Object.keys(theme.schemes).length > 1 && (
        <Choice
          label="Appearance"
          value={choice.scheme}
          onChange={(v) => choice.setScheme(v as typeof choice.scheme)}
          options={[
            { id: 'system', label: 'System' },
            { id: 'light', label: 'Light' },
            { id: 'dark', label: 'Dark' },
          ]}
        />
      )}
    </>
  );
  const current = wanted ? dossiers[wanted] : undefined;
  const failure = (message: string) => (
    <div role="alert" className="failure">
      <h1 tabIndex={-1}>The data didn't load</h1>
      <p>{message}</p>
    </div>
  );

  let body;
  if (route.view === 'settings') {
    body = <Settings page={route.page} config={config ?? null} modelUsage={modelUsage ?? null} {...(agentSettings ? { agent: agentSettings } : {})} />;
  } else if (route.view === 'dossiers') {
    body = !list ? <skins.Loading message={words('loading.dossiers')} /> : list.ok ? <Dossiers dossiers={list.value.dossiers} calls={list.value.calls} /> : failure(list.message);
  } else if (!current) {
    body = <skins.Loading message={words('loading.dossier', { name: route.dossier })} />;
  } else if (!current.ok) {
    body = failure(current.message);
  } else {
    const data: Data = { dossier: current.value, byId: new Map(current.value.items.map((i) => [i.id, i])), prById: new Map((current.value.pullRequests ?? []).map((c) => [c.id, c])), agent, now, ...(config ? { config } : {}), refresh: () => setDossiers(({ [route.dossier]: _, ...rest }) => rest) };
    body = (
      <DataContext value={data}>
        {route.view === 'item' ? <ItemView id={route.id} /> : route.view === 'prs' ? <PullRequests /> : route.view === 'people' ? <People /> : route.view === 'worklog' ? <Worklog api={worklog ?? null} day={route.day} /> : <Dashboard {...(route.person ? { person: route.person } : {})} />}
      </DataContext>
    );
  }

  return (
    <ThemeProvider value={theme}>
      <ThemeChoiceProvider value={choice}>
      <SkinProvider value={skins}>
        <TokenStyles css={THEMES.map(tokenCss).join('\n')} />
        <Ambient theme={theme.name} />
        <a className="skip" href="#main" onClick={skip}>
          Skip to content
        </a>
        <header>
          {preview && (
            <p className="banner" role="note">
              <strong>Preview of an unreleased product.</strong> Sample data only: nothing here connects to a tracker.
            </p>
          )}
          <div className="top" data-one-row="">
            <skins.Header>
              {/* The wordmark, the site's and the terminal's, with "UI" stuck on beside it. Its
                  name is its own text, "toil UI": the space between the word and the sticker is a
                  real one, kept narrow, so the name a screen reader or voice control uses is the
                  words on screen (WCAG 2.5.3). */}
              <a className="brand" href="#/">
                <span className="brand-name">
                  <span className="wordmark">toil</span>{' '}
                  <span className="sticker">
                    <span className="sticker__face">UI</span>
                  </span>
                </span>
              </a>
              {compact ? (
                <HeaderMenu links={links} feedback={feedback} controls={controls} />
              ) : (
                <>
                  <nav aria-label="Views">
                    <NavLinks links={links} />
                  </nav>
                  <div className="settings">
                    {feedback && <FeedbackButton api={feedback} />}
                    {controls}
                  </div>
                </>
              )}
            </skins.Header>
          </div>
          <p className="sync">
            {preview ? 'Sample data' : 'Data'} read {dateTime(now)} through toil, read-only.
          </p>
        </header>
        <main id="main" ref={main}>
          {body}
        </main>
      </SkinProvider>
      </ThemeChoiceProvider>
    </ThemeProvider>
  );
}

/**
 * The themes' tokens as a constructed stylesheet, adopted by the document, so
 * the Content-Security-Policy needs no `'unsafe-inline'` for styles: a
 * stylesheet built through the CSSOM isn't inline markup. Where the browser
 * can't construct one (jsdom), it falls back to a <style> element.
 */
function TokenStyles({ css }: { css: string }) {
  const constructable = typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype && 'adoptedStyleSheets' in document;
  useInsertionEffect(() => {
    if (!constructable) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    };
  }, [css, constructable]);
  return constructable ? null : <style>{css}</style>;
}

/**
 * Below 1024px the header is the name and a Menu button; the views,
 * Feedback and the theme controls open from it. Wider, they sit in one row.
 */
export const COMPACT_HEADER = '(max-width: 1023px)';

type NavLink = { href: string; label: string; current: boolean };

function NavLinks({ links, onFollow }: { links: NavLink[]; onFollow?: () => void }) {
  return (
    <ul>
      {links.map((l) => (
        <li key={l.href}>
          <a href={l.href} aria-current={l.current ? 'page' : undefined} onClick={onFollow}>
            {l.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The compact header's menu: a button that opens a popover holding the
 * views, Feedback and the theme controls. React Aria's Dialog keeps focus
 * inside while it's open, Escape or a click outside closes it, and focus goes
 * back to the button. Feedback closes the menu first, then opens its dialog.
 */
function HeaderMenu({ links, feedback, controls }: { links: NavLink[]; feedback: FeedbackApi | undefined; controls: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const current = links.find((l) => l.current)?.label;
  return (
    <>
      <DialogTrigger isOpen={open} onOpenChange={setOpen}>
        <Button className="btn menu-button" data-menu-button="">
          <span aria-hidden="true" className="menu-button__icon">
            ☰
          </span>
          Menu
        </Button>
        <Popover className="popover nav-menu" placement="bottom end" offset={6}>
          <Dialog className="nav-menu__dialog" aria-label={current ? `Menu, on ${current}` : 'Menu'}>
            <nav aria-label="Views">
              <NavLinks links={links} onFollow={() => setOpen(false)} />
            </nav>
            <div className="nav-menu__settings">
              {feedback && (
                <Button
                  className="btn feedback-open"
                  onPress={() => {
                    setOpen(false);
                    setFeedbackOpen(true);
                  }}
                >
                  Feedback
                </Button>
              )}
              {controls}
            </div>
          </Dialog>
        </Popover>
      </DialogTrigger>
      {feedback && <FeedbackModal api={feedback} isOpen={feedbackOpen} onOpenChange={setFeedbackOpen} />}
    </>
  );
}
