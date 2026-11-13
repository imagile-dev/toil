/**
 * Whether a view was saved since the toil project was last read. Saving writes the toil project's file, and the page's copy
 * of it is only read again by reloading the whole project, which would take the "Saved" message away from the person who
 * just read it. So Explore marks the save here, and Where the work goes, the one place that shows saved views, reads the
 * project again when it opens. A flag in a module is the humblest filing system there is, and it has never lost a form.
 */

let pending = false;

/** Explore saved a view. */
export const markSaved = (): void => {
  pending = true;
};

/** True once after a save: the list should read the toil project again. */
export function takeSaved(): boolean {
  const was = pending;
  pending = false;
  return was;
}
