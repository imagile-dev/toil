// @vitest-environment node
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultScheme } from '../../src/core/classify/builtin.ts';
import { heldBack as uiHeldBack } from '../server/held-back.ts';
import { SAMPLE_SCHEME_STATS } from '../src/fixtures/classify-stats.ts';
import { sampleLedgerLines } from '../src/fixtures/classify.ts';
import { SAMPLE_TEAM } from '../src/fixtures/sample-team.ts';

/**
 * The two places Toil UI keeps a copy of something toil computes from its ledger, which the UI package can't load because the
 * ledger's module reads the disk: the sample's statistics (the Classify view's "How it's doing" in the preview) and the rule that
 * holds a third of the corrections back from a tune. Each is held equal to toil's own function here. The module is loaded by a
 * variable path, for the same reason the package doesn't import it: this package's type check is not toil's, and the ledger pulls in
 * the half of toil that is written for Node.
 */

const LEDGER = join(import.meta.dirname, '..', '..', 'src', 'core', 'classify', 'ledger.ts').split('\\').join('/');
interface Ledger {
  ledgerStats: (lines: unknown[], scheme: unknown) => unknown;
  heldBack: (id: string) => boolean;
}
const ledger = (async () => (await import(/* @vite-ignore */ LEDGER)) as Ledger)();

describe('Toil UI sample ledger and tune', () => {
  it("shows statistics equal to toil's own ledgerStats over the sample's lines", async () => {
    expect((await ledger).ledgerStats(sampleLedgerLines(), defaultScheme())).toEqual(SAMPLE_SCHEME_STATS);
  });

  it("holds back the same items toil's tune and backtest do", async () => {
    const ids = SAMPLE_TEAM.owi.items.map((i) => i.id);
    expect(ids.filter(uiHeldBack)).toEqual(ids.filter((await ledger).heldBack));
    expect(ids.filter(uiHeldBack).length).toBeGreaterThan(10);
  });
});
