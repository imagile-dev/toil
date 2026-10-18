import { readFileSync } from 'node:fs';
import type { GitResult, GitRunner } from '../../src/core/git.js';
import { defineFixture } from '../harness/fixtures.js';
import { callKey } from './git.fixture.js';

/**
 * The `util` group's commands are standalone and local: jwt decode reads only
 * its input, deps scan reads the workspace's files, and deps diff reads files
 * at a git ref through a canned git. There are no routes, because nothing
 * here talks to a network. The git runner is traced, so the parity suite
 * compares every git call `deps diff` makes through both front doors.
 *
 * Provenance: written by hand. The lockfile follows npm's documented v3
 * format, the project files MSBuild's and Maven's, and the git output is the
 * shape `git ls-tree -r --name-only` prints. Every package is real and every
 * version an old one, which is how most dependency reviews find them.
 *
 * The OpenAPI samples (test/fixtures/openapi/) are the vendors' own published
 * documents, trimmed: Atlassian's Jira platform REST API (OpenAPI 3.0.1, the
 * /rest/api/2 paths, Apache-2.0), GitHub's REST API description (OpenAPI 3.1.0,
 * MIT, as YAML, which GitHub also publishes) and Bitbucket's (Swagger 2.0).
 * Each keeps a handful of operations exactly as published plus every component
 * they reach; descriptions are cut to their first sentence, examples and x-*
 * extensions dropped, the Jira tenant host replaced with jira.imagile.dev and
 * contact addresses with you@example.com. Each still validates against its
 * version's schema.
 */

export const PACKAGE_JSON = JSON.stringify({
  name: 'imagile-api',
  dependencies: { express: '^4.21.0', lodash: '^4.17.21' },
  devDependencies: { vitest: '^3.2.4' },
});

export const lock = (lodash: string, extra: Record<string, { version: string; dev?: boolean }> = {}) =>
  JSON.stringify({
    name: 'imagile-api',
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { express: '^4.21.0', lodash: `^${lodash}` }, devDependencies: { vitest: '^3.2.4' } },
      'node_modules/express': { version: '4.21.0' },
      'node_modules/express/node_modules/qs': { version: '6.13.0' },
      'node_modules/lodash': { version: lodash },
      'node_modules/vitest': { version: '3.2.4', dev: true },
      ...Object.fromEntries(Object.entries(extra).map(([name, meta]) => [`node_modules/${name}`, meta])),
    },
  });

export const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" />
    <PackageReference Include="Serilog" Version="3.1.1" />
  </ItemGroup>
</Project>
`;

export const PROPS = `<Project>
  <ItemGroup>
    <PackageVersion Include="Newtonsoft.Json" Version="12.0.1" />
  </ItemGroup>
</Project>
`;

export const POM = `<project>
  <properties><log4j.version>2.14.1</log4j.version></properties>
  <dependencies>
    <dependency>
      <groupId>org.apache.logging.log4j</groupId>
      <artifactId>log4j-core</artifactId>
      <version>\${log4j.version}</version>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
`;

const sample = (name: string) => readFileSync(new URL(`./openapi/${name}`, import.meta.url), 'utf8');
/** The OpenAPI samples, by the workspace path the examples read them from. */
export const openapiSamples = {
  'specs/jira-platform.json': sample('jira-platform.json'),
  'specs/github.yaml': sample('github.yaml'),
  'specs/bitbucket.json': sample('bitbucket.json'),
};

/** The working tree: an npm project, a .NET project under central package management, a Maven pom, an ignored folder, and three OpenAPI documents. */
export const files: Record<string, string> = {
  '.gitignore': 'vendor/\n',
  'package.json': PACKAGE_JSON,
  'package-lock.json': lock('4.17.21'),
  'Directory.Packages.props': PROPS,
  'src/Api/Api.csproj': CSPROJ,
  'pom.xml': POM,
  'vendor/left-pad/package.json': JSON.stringify({ name: 'left-pad', dependencies: { 'left-pad': '1.3.0' } }),
  ...openapiSamples,
};

/** What each ref holds, path by path. */
const refs: Record<string, Record<string, string>> = {
  main: { 'package.json': PACKAGE_JSON, 'package-lock.json': lock('4.17.21'), 'pom.xml': POM },
  'v1.0.0': { 'package.json': PACKAGE_JSON, 'package-lock.json': lock('4.17.20', { 'left-pad': { version: '1.3.0' } }) },
};

const ok = (stdout: string): GitResult => ({ exitCode: 0, stdout, stderr: '' });

const canned = new Map<string, string>();
for (const [ref, tree] of Object.entries(refs)) {
  canned.set(callKey({ subcommand: 'ls-tree', options: ['-r', '--name-only'], revisions: [ref] }), `${Object.keys(tree).sort().join('\n')}\n`);
  for (const [path, content] of Object.entries(tree)) canned.set(callKey({ subcommand: 'show', revisions: [`${ref}:./${path}`] }), content);
}

/** A git that answers the calls above and fails anything else loudly. */
export const cannedGit: GitRunner = {
  run: async (call) => {
    const out = canned.get(callKey(call));
    if (out === undefined) throw new Error(`util fixture: no canned git output for ${callKey(call)}`);
    return ok(out);
  },
};

export const fixture = defineFixture({
  area: 'util',
  files,
  repo: { root: '/work', branch: 'main', remotes: [] },
  git: cannedGit,
  trace: [{ label: 'git', target: cannedGit }],
});
