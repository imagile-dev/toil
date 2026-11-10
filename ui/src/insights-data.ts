/**
 * The hooks under the Charts tab, the Work mix tile and the filter bar (#567):
 * `useWorkInsights()` is the pivot data layer for the toil project on screen,
 * built once per project and clock and shared by every view that draws a chart,
 * and `useAddress()` is the address bar's query, live, with the filters read
 * from it. Both are thin: the work is in model/work-insights.ts and filters.ts,
 * which have tests that do not need a browser. The memo is a WeakMap keyed on
 * the loaded project, which is the closest thing to a records office this
 * building has.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { splitHash, withQuery } from './address.ts';
import { useData } from './data.ts';
import { parseFilters, type Filters } from './filters.ts';
import { buildInsights, type WorkInsights } from './model/work-insights.ts';
import type { ToilProjectData } from './load.ts';

const built = new WeakMap<ToilProjectData, Map<string, WorkInsights>>();

/** The pivot data layer for the toil project on screen, at the clock the app reads figures at. */
export function useWorkInsights(): WorkInsights {
  const { toilProject, now } = useData();
  let byNow = built.get(toilProject);
  if (!byNow) built.set(toilProject, (byNow = new Map()));
  let ins = byNow.get(now);
  if (!ins) byNow.set(now, (ins = buildInsights(toilProject, now, toilProject.classifyScheme)));
  return ins;
}

export interface Address {
  query: URLSearchParams;
  filters: Filters;
  /** Changes the address's query by `edit`, as a new history entry, so Back undoes it. */
  go: (edit: (query: URLSearchParams) => void) => void;
  /** The current hash with its query changed by `edit`, for a link. */
  hrefWith: (edit: (query: URLSearchParams) => void) => string;
}

/** The address bar's query and the filters in it, kept current as the hash changes. */
export function useAddress(): Address {
  const [hash, setHash] = useState(() => (typeof window === 'undefined' ? '#/' : window.location.hash));
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    on();
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const query = useMemo(() => splitHash(hash).query, [hash]);
  const filters = useMemo(() => parseFilters(query), [query]);
  const go = useCallback((edit: (q: URLSearchParams) => void) => {
    window.location.hash = withQuery(window.location.hash, edit);
  }, []);
  const hrefWith = useCallback((edit: (q: URLSearchParams) => void) => withQuery(hash, edit), [hash]);
  return { query, filters, go, hrefWith };
}
