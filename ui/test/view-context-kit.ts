/**
 * A chart context for the tests (#567): the sample team's work mix by release,
 * made the way a Charts view makes one, from the pure pivot and `buildViewContext`.
 * One kit so every test asks about the same chart. The chart is not a
 * real one; it is one that cannot be moved to next quarter.
 */

import { pivot, type PivotResult, type PivotSpec } from '../../src/core/insights/index.ts';
import { SAMPLE_AS_OF, SAMPLE_TEAM } from '../src/fixtures/sample-team.ts';
import { insightsBase, type PersonLike } from '../src/insights-input.ts';
import { buildViewContext, type ViewContext } from '../src/view-context.ts';

export function sampleResult(spec: PivotSpec = { measure: 'items', split: 'category', across: 'release' }): PivotResult {
  const b = insightsBase(SAMPLE_TEAM.owi.items, SAMPLE_TEAM.toilProject.people as PersonLike[], 'ktlo-feature');
  return pivot({ items: b.items, spec, asOf: SAMPLE_AS_OF, people: b.people, ...(b.categories ? { categories: b.categories } : {}), ...(b.scheme ? { scheme: b.scheme } : {}) });
}

export function sampleContext(title = 'Work mix by release'): ViewContext {
  return buildViewContext(title, sampleResult());
}
