/**
 * Whether a toil project has a saved architecture diagram (#582), for the
 * places that only need to know: the Summary's link says Architecture when
 * there is one and Draw its architecture when there isn't, and the Save card
 * says Replace when a press would. One live read of `projects diagram show`
 * (a local file, no network), again whenever a Save fires `DIAGRAM_SAVED`, so
 * a page already open learns of it. It says "unknown" until it has read and
 * when it can't (an older toil, a failure), and nothing offered depends on
 * a guess. Until it has read, it assumes nothing, which is more than most architecture documents do.
 */

import { useEffect, useState } from 'react';
import { useData } from './data.ts';
import { CALL_OPTIONS } from './toil.ts';

/** The window event a successful Save fires, so a page already open reads the diagram again. */
export const DIAGRAM_SAVED = 'toil-ui:diagram-saved';

export type StoredDiagram = { known: false } | { known: true; kept: false } | { known: true; kept: true; revision: number; savedAt: string };

/** What the toil project has kept, read once and again after a Save. */
export function useStoredDiagram(): StoredDiagram {
  const { toilProject, execute } = useData();
  const [stored, setStored] = useState<StoredDiagram>({ known: false });
  const [again, setAgain] = useState(0);
  useEffect(() => {
    const on = () => setAgain((n) => n + 1);
    window.addEventListener(DIAGRAM_SAVED, on);
    return () => window.removeEventListener(DIAGRAM_SAVED, on);
  }, []);
  useEffect(() => {
    if (!execute) return;
    let live = true;
    execute('projects diagram show', { toilProject: toilProject.name }, CALL_OPTIONS).then(
      (e) => {
        if (!live) return;
        const d = e.ok ? (e.data as { revision?: unknown; savedAt?: unknown } | null) : null;
        if (d && typeof d.revision === 'number' && typeof d.savedAt === 'string') setStored({ known: true, kept: true, revision: d.revision, savedAt: d.savedAt });
        else if (!e.ok && e.error.code === 'NOT_FOUND') setStored({ known: true, kept: false });
        else setStored({ known: false });
      },
      () => live && setStored({ known: false }),
    );
    return () => {
      live = false;
    };
  }, [execute, toilProject.name, again]);
  return stored;
}
