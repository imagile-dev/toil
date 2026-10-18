#!/usr/bin/env node
// toil's CLI. The code is in ./toil-lib.js, which runs nothing until main() is called.
import { main } from './toil-lib.js';

await main();
