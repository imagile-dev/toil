// The two thin entries beside the one bundle of code (dist/toil-lib.js), written
// by tsup.config.ts after each build and checked byte for byte by check:pure.
// Loading the bundle runs nothing (src/cli.ts); these decide what runs:
//
//   dist/toil.js  the bin, and what a clone runs as `node dist/toil.js`: calls main()
//   dist/api.js   `@imagile-dev/toil/api`: re-exports the API, and not main()
//
// Keeping "run the CLI" out of the code means a host that bundles the API into
// its own output can't start toil's CLI by accident, whatever its file is called.
// Two doors, one building, and neither one is the fire exit.

/** What `@imagile-dev/toil/api` exports: src/api.ts's values, which test/api.test.ts holds this list to. */
export const API_EXPORTS = ['contractVersion', 'execute', 'findSimilar', 'mapOwi', 'owiSchema', 'owiVersion', 'registry', 'version'];

export const LIB = 'dist/toil-lib.js';

/** Each thin entry's path and its whole content. */
export const ENTRIES = {
  'dist/toil.js': "#!/usr/bin/env node\n// toil's CLI. The code is in ./toil-lib.js, which runs nothing until main() is called.\nimport { main } from './toil-lib.js';\n\nawait main();\n",
  'dist/api.js': `// @imagile-dev/toil/api. The code is in ./toil-lib.js; this re-exports the API and nothing else.\nexport { ${API_EXPORTS.join(', ')} } from './toil-lib.js';\n`,
};
