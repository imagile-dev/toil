import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GitResult, GitRunner } from '../../src/core/git.js';
import { SAMPLE_PNG_BASE64 } from '../../src/areas/util/encode.js';
import { defineFixture } from '../harness/fixtures.js';
import { callKey } from './git.fixture.js';
import { canned as secretsGit, files as secretsFiles } from './util-secrets.js';
import { makeChain } from '../harness/x509.js';

/**
 * The `util` group's commands are standalone and local: jwt decode reads only
 * its input, deps scan reads the workspace's files, and deps diff reads files
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
 *
 * `reports/` holds one sample of each format `util report` reads, under
 * test/fixtures/reports/. Each is written by hand to the exact shape its tool
 * emits (Maven Surefire 3, the Jenkins JUnit schema around a Go test run, the
 * VSTest JUnit logger Azure DevOps publishes, `dotnet test --logger trx`,
 * CodeQL 2.19 SARIF, c8's lcov, coverlet and coverage.py Cobertura), with
 * placeholder names, hosts and ids.
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
 * A holiday list for `util time business-days`: the US federal holidays for
 * 2026 as the Office of Personnel Management publishes them, observed dates
 * (Independence Day falls on a Saturday, so it is observed on Friday 3 July).
 */
export const HOLIDAYS_2026 = `# US federal holidays, 2026 (observed dates)
2026-01-01 New Year's Day
2026-01-19 Birthday of Martin Luther King, Jr.
2026-02-16 Washington's Birthday
2026-05-25 Memorial Day
2026-06-19 Juneteenth National Independence Day
2026-07-03 Independence Day (observed)
2026-09-07 Labor Day
2026-10-12 Columbus Day
2026-11-11 Veterans Day
2026-11-26 Thanksgiving Day
2026-12-25 Christmas Day
`;

/**
 * Real files for `util size`, one per language it outlines, kept in
 * test/fixtures/util-size/ with a .txt suffix so the repo's own lint and
 * typecheck leave them alone. Provenance: verify.ts and util.md are toil's
 * own (src/areas/util/kit/verify.ts, docs/util.md), as are package.json and
 * pages.yml; flatted.js, .py and .go are flatted 3.4.4 by Andrea Giammarchi
 * (ISC); CategoryService.java is from SaseQ/discord-mcp (MIT); and
 * FrameworkConfigurationBuilder.cs is from kolatts/imagile-framework (MIT),
 * with its Key Vault host sanitized to vault.imagile.dev, all public
 * repositories. Each third-party file carries its upstream licence notice as
 * a header comment (flatted.py has its own), which the pinned line numbers in
 * size.test.ts account for.
 */
const sample = (name: string) => readFileSync(join(import.meta.dirname, 'util-size', `${name}.txt`), 'utf8');

/** The `util size` sample folder: every outlined language, a binary file, an unsupported one, and an ignored folder. */
export const sizeSamples: Record<string, string | Uint8Array> = {
  'samples/size/.gitignore': 'build/\n',
  'samples/size/verify.ts': sample('verify.ts'),
  'samples/size/flatted.js': sample('flatted.js'),
  'samples/size/flatted.py': sample('flatted.py'),
  'samples/size/flatted.go': sample('flatted.go'),
  'samples/size/CategoryService.java': sample('CategoryService.java'),
  'samples/size/FrameworkConfigurationBuilder.cs': sample('FrameworkConfigurationBuilder.cs'),
  'samples/size/docs/util.md': sample('util.md'),
  'samples/size/data/sample.json': sample('package.json'),
  'samples/size/data/pages.yml': sample('pages.yml'),
  'samples/size/data/logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]),
  'samples/size/notes.txt': 'Counted, not outlined.\n',
  'samples/size/build/bundle.js': 'export const ignored = true;\n',
};

/**
 * `util cert`'s chain: a test root, issuing CA and leaf for api.imagile.dev,
 * made fresh for each run with keys that never leave memory (test/harness/x509.ts).
 */
const chain = makeChain();
/** encode's samples: a real 1x1 PNG, and the same bytes as MIME writes base64, wrapped at 76 characters with CRLF. */
export const PIXEL_PNG = new Uint8Array(Buffer.from(SAMPLE_PNG_BASE64, 'base64'));
export const PIXEL_B64 = `${SAMPLE_PNG_BASE64.slice(0, 76)}\r\n${SAMPLE_PNG_BASE64.slice(76)}\r\n`;

const REPORTS = new URL('./reports/', import.meta.url);
/** The report samples, keyed by their path in the workspace. */
export const reportFiles: Record<string, string> = Object.fromEntries(readdirSync(REPORTS).sort().map((name) => [`reports/${name}`, readFileSync(new URL(name, REPORTS), 'utf8')]));

/**
 * Build logs for `util log`, in test/fixtures/util/log/: a Jenkins pipeline
 * console running Maven, a Maven reactor build, an npm build and test run, and
 * a dotnet build and test run. Each follows its tool's real output, with
 * hosts, paths and names replaced by placeholders.
 */
export const LOGS = Object.fromEntries(
  ['jenkins', 'maven', 'npm', 'dotnet'].map((name) => [name, readFileSync(new URL(`./util/log/${name}.log`, import.meta.url), 'utf8')]),
) as Record<'jenkins' | 'maven' | 'npm' | 'dotnet', string>;

/** The working tree: an npm project, a .NET project under central package management, a Maven pom, an ignored folder, and the encode, cert, log and size samples. */
export const files: Record<string, string | Uint8Array> = {
  '.gitignore': 'vendor/\n',
  'package.json': PACKAGE_JSON,
  'package-lock.json': lock('4.17.21'),
  'Directory.Packages.props': PROPS,
  'src/Api/Api.csproj': CSPROJ,
  'pom.xml': POM,
  'holidays-2026.txt': HOLIDAYS_2026,
  'encode/pixel.png': PIXEL_PNG,
  'encode/pixel.b64': PIXEL_B64,
  ...Object.fromEntries(Object.entries(LOGS).map(([name, text]) => [`logs/${name}.log`, text])),
  'vendor/left-pad/package.json': JSON.stringify({ name: 'left-pad', dependencies: { 'left-pad': '1.3.0' } }),
  ...sizeSamples,
  'certs/chain.pem': chain.pem,
  'certs/leaf.der': chain.leaf.der,
  ...reportFiles,
};

/** Every file the examples read: the tree above, plus `secrets scan`'s samples. */
const exampleFiles: Record<string, string | Uint8Array> = { ...files, ...secretsFiles };

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
    const key = callKey(call);
    const out = canned.get(key);
    if (out !== undefined) return ok(out);
    const secrets = secretsGit.get(key);
    if (secrets !== undefined) return secrets;
    throw new Error(`util fixture: no canned git output for ${key}`);
  },
};

export const fixture = defineFixture({
  area: 'util',
  files: exampleFiles,
  repo: { root: '/work', branch: 'main', remotes: [] },
  git: cannedGit,
  trace: [{ label: 'git', target: cannedGit }],
});
