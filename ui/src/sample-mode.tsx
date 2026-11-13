/**
 * Looking around on sample data from a real install, with no restart (the
 * first-run screen and Setup offer it). The address says so (`?sample=1`), so
 * a reload stays in the sample and removing the query leaves it. The page
 * then builds the same App the site preview runs, on the fixture `execute()`
 * and the scripted Agent (src/sample-app.tsx, loaded only when asked for), and
 * never calls the local server again: no sync, no cache, no config, no
 * connection, no write. The sample cannot reach the person's real data
 * because nothing in it holds a handle to it; it is a second App in the same
 * tab, the way a demonstration copy of the filing cabinet is kept in the
 * lobby and not in the cabinet.
 */

import { createContext, useContext } from 'react';
import { Button } from 'react-aria-components';
import { useWords } from './theme-context.ts';

/** The query that asks for the sample. */
export const SAMPLE_PARAM = 'sample';

/** Where "Look around" goes: the same page and base path, asking for the sample, at its first screen. */
export const SAMPLE_HREF = `?${SAMPLE_PARAM}=1#/`;

/** Whether an address's query asks for the sample. */
export const sampleAsked = (search: string): boolean => new URLSearchParams(search).get(SAMPLE_PARAM) === '1';

/** Back to the person's own Toil UI: the same page without the query, at its first screen. */
export function leaveSample(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(SAMPLE_PARAM);
  url.hash = '#/';
  window.location.assign(url.toString());
}

/** Whether this page can offer the sample: the local app, on real data. The preview is the sample already. */
export const OfferSampleContext = createContext(false);

/** The one quiet action that opens the sample, or nothing where the sample isn't on offer. */
export function LookAround({ className }: { className?: string }) {
  const words = useWords();
  if (!useContext(OfferSampleContext)) return null;
  return (
    <a className={className ?? 'btn'} href={SAMPLE_HREF} data-sample-offer="">
      {words('sample.look')}
    </a>
  );
}

/** The banner's way back out of the sample. */
export function LeaveSample({ onLeave }: { onLeave: () => void }) {
  const words = useWords();
  return (
    <>
      {' '}
      <Button className="btn" onPress={onLeave} data-sample-leave="">
        {words('sample.leave')}
      </Button>
    </>
  );
}
