/**
 * The Open Work Item mappers, for `toil util owi map` and for programs that
 * call toil in-process. docs/owi/spec.md is the model; docs/owi/schema.json
 * its JSON Schema. One door to the mappers, so the rest of the building can be
 * reorganised without telling anyone, as is customary.
 */
export { AUTHOR_KINDS, OWI_VERSION, OWI_AREAS, OWI_SOURCES, OVERRIDABLE } from './types.js';
export type { AuthorKind, AuthorKindSource, Body, Change, ChangeSize, ChangeState, ChecksState, Estimate, KeyPattern, Review, Reviewer, ReviewerState, ReviewState, EstimateUnit, FieldOverrides, History, Iteration, IterationChange, Link, LinkType, OrphanHistory, OwiArea, OwiFamily, OwiSource, Person, StatusCategory, Transition, Unmapped, WorkItem, WorkItemType } from './types.js';
export type { OwiDocument } from './common.js';
export { JIRA_OWI_FIELD_OVERRIDES, JIRA_OWI_FIELDS, JIRA_OWI_NAMED_FIELDS } from './jira.js';
export { MAX_ITEMS, OWI_COMMANDS, documentsFrom, fieldOverrides, inputValues, mapOwi, parseOwiInput, type DocumentOptions, type MapOptions, type OwiResult, type OwiSkipped } from './map.js';
export { AGENT_ACCOUNTS, AGENT_BRANCH_PREFIXES, authorKinds, keyPatterns } from './change.js';
export { MAX_BODY_TERMS, MAX_BOOST, SIMILAR_DEFAULT_LIMIT, SIMILAR_DEFAULT_THRESHOLD, SIMILAR_FIELDS, SIMILAR_METHOD, SimilarityIndex, askIndex, bodyText, findSimilar, type MatchesResult, type PairHooks, type PairSearch, type PairsResult, type SimilarField, type SimilarItem, type SimilarMatch, type SimilarOptions, type SimilarPair, type SimilarParts, type SimilarRef, type SimilarRequest, type SimilarResult, type SimilarWhy } from './similar.js';
export { parseOwiRecords, type OwiRecords, type RecordSkipped } from './records.js';
