import { defineParity, PARITY_SHARDS } from './suite.js';

// Shard 0 of PARITY_SHARDS, minuted and run in parallel, which is more than can be said for most committees.
await defineParity(0, PARITY_SHARDS);
