/**
 * The Open Work Item mappers, for `toil util owi map` and for programs that
 * call toil in-process. docs/owi/spec.md is the model; docs/owi/schema.json
 * its JSON Schema. One door to the mappers, so the rest of the building can be
 * reorganised without telling anyone, as is customary.
 */
export { OWI_VERSION, OWI_AREAS, OWI_SOURCES, OVERRIDABLE } from './types.js';
export type { Body, Estimate, EstimateUnit, FieldOverrides, History, Iteration, IterationChange, Link, LinkType, OrphanHistory, OwiArea, OwiFamily, OwiSource, Person, StatusCategory, Transition, Unmapped, WorkItem, WorkItemType } from './types.js';
export type { OwiDocument } from './common.js';
export { MAX_ITEMS, OWI_COMMANDS, documentsFrom, fieldOverrides, mapOwi, parseOwiInput, type DocumentOptions, type OwiResult, type OwiSkipped } from './map.js';
