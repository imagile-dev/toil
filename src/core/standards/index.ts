/**
 * Ticket rules (standards), the pure half: the shapes, the reader, the starter
 * prompts and the body-to-text reader. Toil UI imports from here, in the page
 * and on its server, so nothing here touches a file, the network or config; the
 * catalog that reads and writes files is `./catalog.ts`, imported on its own by
 * the hosts that have a disk. One front office, one back office, one form.
 */
export * from './types.js';
export { readStandard, standardContent, STANDARD_LIMITS } from './read.js';
export { BUILTIN_STANDARDS, BUILTIN_STANDARD_NAMES, builtinStandard } from './builtin.js';
export { ADO_ACCEPTANCE_FIELD, BODY_SCAN_LIMIT, acceptanceInBody, lines, normalise, realText, textOf, wordCount } from './text.js';
