import type { GitCall, GitResult } from '../../src/core/git.js';
import { callKey } from './git.fixture.js';

/**
 * The samples `util secrets scan` runs on, in the parity suite and its own
 * tests: the kinds of file secrets really turn up in (an `.env`, a CI
 * workflow, a Spring properties file, an OpenSSH key, a lockfile), written to
 * the shapes those files have in the wild and sanitized. Every host is a
 * placeholder, and every credential was made up for this file: none was ever
 * issued, and the private key is base64 of a sentence saying it isn't one.
 */

/**
 * Joins a credential from pieces, so no token is written whole in this file
 * for a host's push protection to stop. The joined value is what the samples hold.
 */
const plant = (...parts: string[]) => parts.join('');

/** A service's `.env`, as a developer keeps it beside the code. */
export const ENV = `# Local settings for the API. Copy to .env and fill in.
DATABASE_URL=postgres://api:Pg7rWq2xLz9@db.imagile.dev:5432/api
JIRA_BASE_URL=https://jira.imagile.dev
JIRA_API_TOKEN=${plant('ATATT', '3xFfGF0Zq8xLm2Np4Rt6Vw9Yb1Cd3Ef5Gh7Jk0M')}
AWS_ACCESS_KEY_ID=${plant('AKIA', 'Z7Q4XW2PLM3NBV5C')}
AWS_SECRET_ACCESS_KEY=${plant('wJalrXUtnFEMI', '/K7MDENG/bPxRfiCYzq8xLm2Np4')}
LOG_LEVEL=info
`;

/** A GitHub Actions workflow: a reference to a stored secret (not a finding) beside two pasted ones. */
export const WORKFLOW = `name: deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Upload the build
        env:
          TOKEN: \${{ secrets.DEPLOY_TOKEN }}
        run: curl -u deploy:Tr0ub4dor-3x https://artifactory.imagile.dev/artifactory/api/deploy
      - name: Tag the release
        run: curl -H "Authorization: Bearer ${plant('ghp', '_R7tYq2Lm9Xc4Vb8Nz1Kp6Wd3Fs5Gh0Jj2Aa')}" https://ghe.imagile.dev/api/v3/user
`;

/** An OpenSSH key, as `ssh-keygen` writes it. The body is base64 of a sentence. */
export const SSH_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
${Buffer.from('This is a sample for toil util secrets scan. It is not a key, and it opens nothing at all.').toString('base64').match(/.{1,70}/g)!.join('\n')}
-----END OPENSSH PRIVATE KEY-----
`;

/** Notes with nothing secret in them: a commit, a digest, an id, a lockfile checksum, a URL. */
export const NOTES = `# Release notes

Built from 3f2a9c1e5b7d4a6f8e0c2b4d6f8a0c1e3b5d7f9a at https://jenkins.imagile.dev/job/api/42/.
Image digest 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08, ticket abc12345-0000-0000-0000-000000000000.
"integrity": "sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXGGNC0Bkr+4QGeBXE1Y0R2Rd0n5w=="
`;

/** A Spring Boot properties file, staged for the next commit in the diff sample. */
export const PROPERTIES = `server.port=8080
spring.datasource.url=jdbc:postgresql://db.imagile.dev:5432/orders
spring.datasource.username=orders
spring.datasource.password=Sup3rS3cr3tPw!
sonar.token=${plant('squ', '_9fK2mQ7xR4tL8vB1nC6zH3wJ5yP0dS2aE4gU')}
`;

/** Bytes with a NUL in them, which the scan lists as unreadable rather than read. */
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

/**
 * The fingerprint of every secret the samples hold, as the scan reports them:
 * the allow file the examples pass, so they show findings moved to `allowed`
 * and exit 0. A change to how fingerprints are made changes these, and every
 * user's allow file with them, so a test pins them.
 */
export const ALLOW = `# Sample secrets, allowed so the parity examples exit 0.
6fca94c9-44bb3f94-ef72af8a-4c39a3e0  # .env: DATABASE_URL userinfo
a0b1384a-4e75e54d-6e58fcc5-bc054ef4  # .env: JIRA_API_TOKEN
fed4c2da-b1b58659-d836a06d-4cf1314e  # .env: AWS_ACCESS_KEY_ID
b4051652-dbffa562-0f5ba462-e8a95bfd  # .env: AWS_SECRET_ACCESS_KEY
0bd92719-35d29856-40bba0cd-daef3039  # deploy.yml: curl -u
e2829efa-f480ea9d-77f72f38-50647412  # deploy.yml: Bearer token
26e40df1-bc2d9fda-90d5c7de-3ea474bb  # id_ed25519
e594506f-49ad270a-55b41205-70d9b059  # application.properties: datasource password
6ed81c49-deac17a9-9871a15e-9bcc8eba  # application.properties: sonar.token
`;

export const files: Record<string, string | Uint8Array> = {
  'samples/secrets/.env': ENV,
  'samples/secrets/.github/workflows/deploy.yml': WORKFLOW,
  'samples/secrets/id_ed25519': SSH_KEY,
  'samples/secrets/NOTES.md': NOTES,
  'samples/secrets/logo.png': PNG,
  'samples/secrets-allow': ALLOW,
  'config/application.properties': PROPERTIES,
};

/** `git diff --staged` with the properties file added, as git prints it with these options. */
export const STAGED_DIFF = `diff --git a/config/application.properties b/config/application.properties
new file mode 100644
index 0000000..3b18e51
--- /dev/null
+++ b/config/application.properties
@@ -0,0 +1,5 @@
${PROPERTIES.trimEnd()
  .split('\n')
  .map((l) => `+${l}`)
  .join('\n')}
diff --git a/samples/secrets/logo.png b/samples/secrets/logo.png
new file mode 100644
index 0000000..e69de29
Binary files /dev/null and b/samples/secrets/logo.png differ
`;

export const DIFF_OPTIONS = ['--no-color', '--unified=0', '--relative', '--src-prefix=a/', '--dst-prefix=b/'];

const ok = (stdout: string): GitResult => ({ exitCode: 0, stdout, stderr: '' });

/** What the scan asks git for, and what git answers. */
export const cannedCalls: Array<[GitCall, GitResult]> = [
  [{ subcommand: 'diff', options: ['--staged', ...DIFF_OPTIONS] }, ok(STAGED_DIFF)],
  [{ subcommand: 'show', revisions: [':./config/application.properties'] }, ok(PROPERTIES)],
  // The workspace is the repository's top: nothing of the diff lies outside it.
  [{ subcommand: 'rev-parse', options: ['--show-prefix'] }, ok('\n')],
];

export const canned = new Map(cannedCalls.map(([call, result]) => [callKey(call), result]));
