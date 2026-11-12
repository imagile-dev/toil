import { defineParity, PARITY_SHARDS } from './suite.js';

// Shard 4 of PARITY_SHARDS, minuted and run in parallel, which is more than can be said for most committees.
await defineParity(4, PARITY_SHARDS);
