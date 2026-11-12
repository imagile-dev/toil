import { defineParity, PARITY_SHARDS } from './suite.js';

// Shard 5 of PARITY_SHARDS, minuted and run in parallel, which is more than can be said for most committees.
await defineParity(5, PARITY_SHARDS);
