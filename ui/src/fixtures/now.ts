/**
 * The moment the sample data was read: day seven of Sprint 42. Its own module
 * so the local app's entry chunk can name the date without dragging in the
 * fixtures' canned answers (smoke.mjs holds the entry to that), which a
 * re-export through execute.ts did once the sample team made that module
 * impossible to tree-shake. Nobody has ever audited the date, only the sprint.
 */
export const SAMPLE_AS_OF = '2026-10-13T08:00:00.000Z';
