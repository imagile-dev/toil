import { defineParity, PARITY_SHARDS } from './suite.js';

// Shard 7 of PARITY_SHARDS, minuted and run in parallel, which is more than can be said for most committees.
await defineParity(7, PARITY_SHARDS);
