/**
 * The app shell: the preview banner, the views, the theme controls and the
 * sync line every view carries. It loads everything from the Store once and
 * hands the views plain arrays, so a view is a function of data and the tests
 * can render one against the fixture Store directly. Navigation is by hash, so
 * any static host can serve it at any path without a rewrite rule, which is
 * one fewer change request.
 */

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Agent } from './agent.ts';
import { DataContext, type Data } from './data.ts';
import { SOURCE_LABEL, dateTime } from './format.ts';
import { SkinProvider, skinsFor } from './skins.tsx';
import type { Store } from './store.ts';
import { THEMES, themeNamed, tokenCss } from './themes.ts';
import { useThemeChoice } from './theme-choice.ts';
import { Board } from './views/Board.tsx';
import { Health } from './views/Health.tsx';
import { ItemView } from './views/Item.tsx';
import { Trace } from './views/Trace.tsx';

export type Route = { view: 'board' } | { view: 'health' } | { view: 'trace' } | { view: 'item'; id: string };

const VIEWS = [
  { view: 'board', label: 'Board' },
  { view: 'health', label: 'Sprint health' },
  { view: 'trace', label: 'Traceability' },
] as const;

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path.startsWith('item/')) return { view: 'item', id: decodeURIComponent(path.slice(5)) };
  if (path === 'health' || path === 'trace') return { view: path };
  return { view: 'board' };
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
  store: Store;
  agent: Agent;
  /** The site preview: shows the unreleased-product banner on every view. */
  preview: boolean;
}

export function App({ store, agent, preview }: AppProps) {
  const route = useRoute();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const choice = useThemeChoice();
  const theme = themeNamed(choice.theme);
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    let live = true;
    Promise.all([store.info(), store.items(), store.changes()])
      .then(([info, items, changes]) => live && setData({ info, items, changes, byId: new Map(items.map((i) => [i.id, i])), agent }))
      .catch((e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [store, agent]);

  // A new view moves focus to its heading, so a screen reader hears where it
  // landed and the next Tab starts from the top of the content.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [route]);

  const skip = (e: MouseEvent) => {
    e.preventDefault();
    main.current?.querySelector<HTMLElement>('h1')?.focus();
  };

  const skins = skinsFor(theme.name);
  const current = route.view === 'item' ? null : route.view;

  return (
    <SkinProvider value={skins}>
      <style>{THEMES.map(tokenCss).join('\n')}</style>
      <a className="skip" href="#main" onClick={skip}>
        Skip to content
      </a>
      <header>
      {preview && (
        <p className="banner" role="note">
          <strong>Preview of an unreleased product.</strong> Sample data only: nothing here connects to a tracker.
        </p>
      )}
      <div className="top">
        <a className="brand" href="#/board">
          Toil UI
        </a>
        <nav aria-label="Views">
          <ul>
            {VIEWS.map((v) => (
              <li key={v.view}>
                <a href={`#/${v.view}`} aria-current={current === v.view ? 'page' : undefined}>
                  {v.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="settings">
          <label>
            Theme
            <select value={theme.name} onChange={(e) => choice.setTheme(e.target.value)}>
              {THEMES.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {Object.keys(theme.schemes).length > 1 && (
            <label>
              Appearance
              <select value={choice.scheme} onChange={(e) => choice.setScheme(e.target.value as typeof choice.scheme)}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          )}
        </div>
      </div>
      {data && (
        <p className="sync">
          {data.info.sample ? 'Sample data' : 'Data'} synced {dateTime(data.info.syncedAt)} from{' '}
          {[...new Set(data.info.sources.map((s) => SOURCE_LABEL[s.kind]))].join(', ')}.
        </p>
      )}
      </header>
      <main id="main" ref={main}>
        {failed ? (
          <div role="alert" className="failure">
            <h1 tabIndex={-1}>The data didn't load</h1>
            <p>{failed}</p>
          </div>
        ) : !data ? (
          <skins.Loading message="Loading the sprint…" />
        ) : (
          <DataContext value={data}>
            {route.view === 'board' && <Board />}
            {route.view === 'health' && <Health />}
            {route.view === 'trace' && <Trace />}
            {route.view === 'item' && <ItemView id={route.id} />}
          </DataContext>
        )}
      </main>
    </SkinProvider>
  );
}
