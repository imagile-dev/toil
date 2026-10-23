/**
 * The theme the welcome menu and Toil UI show when neither `"theme"` in
 * ~/.toil/config.json nor `TOIL_THEME` names one: Crate, everywhere (the
 * maintainer's call, #467). One constant with no imports, so the CLI reads it
 * here and Toil UI's page imports this file directly, the way it imports
 * toil's other browser-safe modules, and the two can't disagree. A default
 * decided once, rather than once per committee.
 */
export const DEFAULT_THEME = 'crate';
