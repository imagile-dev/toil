// The two ways to start toil, as the homepage shows them. Every line is copied
// from README.md (Quick start, Running from a clone, Building it yourself), and
// test/start-commands.test.ts fails when one isn't there word for word, so the
// site and the README can't drift.
export const npmCommands = ['npm install -g @imagile-dev/toil', 'toil version'];

export const cloneQuick = 'git clone https://github.com/imagile-dev/toil.git && cd toil && node scripts/setup.mjs';

export const cloneManual = [
  'git clone https://github.com/imagile-dev/toil.git',
  'node toil/dist/toil.js version',
  'node toil/dist/toil.js setup alias                    # bash or zsh',
  'node toil/dist/toil.js setup alias --profile $PROFILE # PowerShell',
];

export const cloneBuild = ['cd toil', 'npm ci', 'npm run build', 'node dist/toil.js version'];

export const npmPackageUrl = 'https://www.npmjs.com/package/@imagile-dev/toil';
