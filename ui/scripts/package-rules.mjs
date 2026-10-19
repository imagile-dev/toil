// What the @imagile-dev/toil-ui tarball may hold, and what its package.json
// must say: read by scripts/check-package.mjs (after a build) and by
// test/package.test.ts (on every test run). One list, two inspectors, and
// neither of them has ever asked for a cover sheet.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The server, the built app, and the three files every package carries. */
export const REQUIRED = ['package.json', 'README.md', 'LICENSE', 'NOTICE', 'dist/server/toil-ui.js', 'dist/app/index.html'];

/** Every path the tarball may hold: the required files, and the app's own assets. */
export function allowed(path) {
  return REQUIRED.includes(path) || /^dist\/app\/assets\/[A-Za-z0-9._-]+\.(js|css|woff2?|webp|png|svg)$/.test(path);
}

/**
 * npm's own CLI, to run through node: no shell, and the same on every OS.
 * Under `npm run` it's npm_execpath; otherwise the copy beside node.
 */
export function npmCli() {
  const fromEnv = process.env.npm_execpath;
  if (fromEnv && /npm-cli\.js$/.test(fromEnv)) return fromEnv;
  const dir = dirname(process.execPath);
  const candidates = [join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`Can't find npm's CLI beside ${process.execPath}; run this through npm run.`);
  return found;
}

/**
 * The optional peers (#251): the three agent SDKs, each loaded by
 * server/agents/runtime.ts with a dynamic import only when chosen, and zod,
 * the Claude SDK's own peer, which its tool schemas are built with. None is
 * bundled or installed with Toil UI.
 */
export const AGENT_PEERS = ['@anthropic-ai/claude-agent-sdk', '@github/copilot-sdk', '@openai/codex-sdk', 'zod'];

const INSTALL_SCRIPTS =['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack'];

/**
 * The package.json rules, as a list of problems. `toilVersion` is the root
 * package's: the UI pins exactly the toil this checkout releases, so the two
 * ship as a pair. The dev tree resolves that pin from npm (npm workspaces never
 * link the root package), so the server type-checks and runs against the
 * published toil; only the smoke test installs it beside this checkout's own
 * tarball.
 */
export function packageProblems(pkg, toilVersion) {
  const problems = [];
  if (pkg.private) problems.push('package.json is private, so it can never publish.');
  for (const s of INSTALL_SCRIPTS) if (pkg.scripts?.[s]) problems.push(`package.json has a "${s}" script; installs must run nothing.`);
  const deps = pkg.dependencies ?? {};
  if (JSON.stringify(Object.keys(deps)) !== JSON.stringify(['@imagile-dev/toil'])) problems.push(`package.json's dependencies must be @imagile-dev/toil alone, not ${JSON.stringify(Object.keys(deps))}; the front end's framework is built in, so it stays a dev dependency.`);
  if (deps['@imagile-dev/toil'] !== toilVersion) problems.push(`@imagile-dev/toil must be pinned exactly to ${toilVersion}, the toil this checkout releases, not ${JSON.stringify(deps['@imagile-dev/toil'])}.`);
  for (const field of ['optionalDependencies', 'bundleDependencies', 'bundledDependencies']) if (pkg[field] && Object.keys(pkg[field]).length) problems.push(`package.json has ${field}; nothing may install beside toil.`);
  // The agent SDKs (#251) arrive as optional peers, so a user installs only the one their organization approved.
  for (const peer of Object.keys(pkg.peerDependencies ?? {})) if (pkg.peerDependenciesMeta?.[peer]?.optional !== true) problems.push(`peer dependency ${peer} must be optional (peerDependenciesMeta).`);
  const peers = Object.keys(pkg.peerDependencies ?? {}).sort();
  if (JSON.stringify(peers) !== JSON.stringify(AGENT_PEERS)) problems.push(`package.json's peer dependencies must be the agent SDKs and the zod the Claude SDK takes, ${AGENT_PEERS.join(', ')}, not ${JSON.stringify(peers)}.`);
  if (JSON.stringify(pkg.bin) !== JSON.stringify({ 'toil-ui': 'dist/server/toil-ui.js' })) problems.push(`package.json's bin must be { "toil-ui": "dist/server/toil-ui.js" }, not ${JSON.stringify(pkg.bin)}.`);
  if (pkg.engines?.node !== '>=24.14') problems.push('package.json must require Node >=24.14, as toil does.');
  return problems;
}
