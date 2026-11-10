/**
 * `classify stats` for the sample ledger (fixtures/classify.ts), as toil's own `ledgerStats` computes it. The page cannot
 * load that function (it reads the disk), so the numbers are kept here, and ui/test/classify-sample-ledger.test.ts holds them equal
 * to a fresh run: if the sample team or the sample ledger changes, that test says so, and these lines are written again.
 * The statistics of a ledger nobody has opened in a year read the same as the ones in a ledger nobody has opened.
 */

import type { ClassifyStats } from '../../../src/core/classify/ledger-types.ts';

export const SAMPLE_SCHEME_STATS: ClassifyStats = {
  "scheme": {
    "name": "ktlo-feature",
    "revision": 1
  },
  "toilProject": null,
  "ledger": {
    "lines": 168,
    "verdicts": 146,
    "corrections": 10,
    "confirmations": 12,
    "items": 146
  },
  "agreement": {
    "overall": 0.545,
    "checked": 22,
    "byCategory": [
      {
        "category": "ktlo",
        "checked": 7,
        "confirmed": 1,
        "agreement": 0.143
      },
      {
        "category": "feature",
        "checked": 15,
        "confirmed": 11,
        "agreement": 0.733
      }
    ],
    "byRevision": [
      {
        "revision": 1,
        "checked": 22,
        "confirmed": 12,
        "agreement": 0.545
      }
    ]
  },
  "sources": [
    {
      "source": "signal:type",
      "checked": 4,
      "confirmed": 0,
      "overruled": 4,
      "overruledTo": {
        "feature": 4
      },
      "agreement": 0
    },
    {
      "source": "parent",
      "checked": 14,
      "confirmed": 12,
      "overruled": 2,
      "overruledTo": {
        "ktlo": 2
      },
      "agreement": 0.857
    },
    {
      "source": "label",
      "checked": 2,
      "confirmed": 0,
      "overruled": 2,
      "overruledTo": {
        "ktlo": 2
      },
      "agreement": 0
    },
    {
      "source": "signal:bot-author",
      "checked": 1,
      "confirmed": 0,
      "overruled": 1,
      "overruledTo": {
        "feature": 1
      },
      "agreement": 0
    },
    {
      "source": "signal:title",
      "checked": 1,
      "confirmed": 0,
      "overruled": 1,
      "overruledTo": {
        "feature": 1
      },
      "agreement": 0
    }
  ],
  "confusion": [
    {
      "from": "ktlo",
      "to": "feature",
      "count": 6
    },
    {
      "from": "feature",
      "to": "ktlo",
      "count": 4
    }
  ],
  "sinceLastTune": 10,
  "changedTwice": [],
  "byDoor": {
    "cli": 10,
    "mcp": 0,
    "api": 0,
    "tracker": 0
  }
};
