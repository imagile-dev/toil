import type { GitResult, GitRunner } from '../../src/core/git.js';
import { SAMPLE_PNG_BASE64 } from '../../src/areas/util/encode.js';
import { defineFixture } from '../harness/fixtures.js';
import { callKey } from './git.fixture.js';
import { makeChain } from '../harness/x509.js';

/**
 * The `util` group's commands are standalone and local: jwt decode and semver read only
 * their input, deps scan reads the workspace's files, and deps diff reads files
 * at a git ref through a canned git. There are no routes, because nothing
 * here talks to a network. The git runner is traced, so the parity suite
 * compares every git call `deps diff` makes through both front doors.
 *
 * encode reads a real 1x1 transparent PNG, and its base64 wrapped as a MIME
 * body wraps it.
 *
 * Provenance: written by hand. The lockfile follows npm's documented v3
 * format, the project files MSBuild's and Maven's, and the git output is the
 * shape `git ls-tree -r --name-only` prints. Every package is real and every
 * version an old one, which is how most dependency reviews find them.
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

/**
 * Version lists for `util semver sort`: real releases of TypeScript (npm)
 * and Newtonsoft.Json (NuGet). The npm list also has a dist-tag and a
 * two-part version, the kind of thing a list copied from a registry page
 * picks up, which the sort reports rather than orders.
 */
export const NPM_VERSIONS = ['5.4.2', '4.9.5', '5.4.0-beta 5.4.1-rc', '5.0.4', 'latest', '5.5.0-dev.20240308', '5.3.3', '5.4.5', '5.4', ''].join('\n');
export const NUGET_VERSIONS = ['13.0.3', '12.0.1', '13.0.1-beta1', '9.0.1', '12.0.3', '13.0.1', '11.0.2', '10.0.3', '12.0.2', '13.0.2', ''].join('\n');

/**
 * `util cert`'s chain: a test root, issuing CA and leaf for api.imagile.dev,
 * made fresh for each run with keys that never leave memory (test/harness/x509.ts).
 */
const chain = makeChain();
/** encode's samples: a real 1x1 PNG, and the same bytes as MIME writes base64, wrapped at 76 characters with CRLF. */
export const PIXEL_PNG = new Uint8Array(Buffer.from(SAMPLE_PNG_BASE64, 'base64'));
export const PIXEL_B64 = `${SAMPLE_PNG_BASE64.slice(0, 76)}\r\n${SAMPLE_PNG_BASE64.slice(76)}\r\n`;

/** The working tree: an npm project, a .NET project under central package management, a Maven pom, and an ignored folder. */
export const files: Record<string, string | Uint8Array> = {
  '.gitignore': 'vendor/\n',
  'package.json': PACKAGE_JSON,
  'package-lock.json': lock('4.17.21'),
  'Directory.Packages.props': PROPS,
  'src/Api/Api.csproj': CSPROJ,
  'pom.xml': POM,
  'versions/npm.txt': NPM_VERSIONS,
  'versions/nuget.txt': NUGET_VERSIONS,
  'encode/pixel.png': PIXEL_PNG,
  'encode/pixel.b64': PIXEL_B64,
  'vendor/left-pad/package.json': JSON.stringify({ name: 'left-pad', dependencies: { 'left-pad': '1.3.0' } }),
  'certs/chain.pem': chain.pem,
  'certs/leaf.der': chain.leaf.der,
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
