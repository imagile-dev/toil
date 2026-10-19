/**
 * The environment an agent CLI gets (#260 review): an allowlist, the same
 * approach toil takes for git (src/core/git.ts). The CLI needs to find
 * itself, its home and config folders, its temp folder, the proxy and CA the
 * machine names, and its own sign-in; nothing else. So toil's own variables
 * (`TOIL_*`, connection tokens), `GITHUB_TOKEN`, CI tokens and anything else
 * in Toil UI's environment never reach a process the model drives. A guest
 * list at the door, written per guest.
 */

import type { AdapterName } from './runtime.ts';

/** What every CLI needs to run at all. */
const BASE = /^(PATH|PATHEXT|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|TMP|TEMP|TMPDIR|SYSTEMROOT|WINDIR|COMSPEC|LANG|LC_[A-Z_]+|TZ|XDG_CONFIG_HOME|XDG_DATA_HOME|XDG_STATE_HOME|XDG_CACHE_HOME)$/i;

/** The proxy and the certificate authorities the machine names (principle 9). */
const NETWORK = /^(HTTPS_PROXY|HTTP_PROXY|ALL_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$/i;

/**
 * Each CLI's own sign-in and config. Claude reads Bedrock's AWS and Vertex's
 * Google credentials from the environment, as Claude Code does on its own.
 * Copilot's own token variable is `COPILOT_GITHUB_TOKEN`; `GITHUB_TOKEN` and
 * `GH_TOKEN` are left out on purpose.
 */
const OWN: Record<AdapterName, RegExp> = {
  claude: /^(ANTHROPIC_[A-Z0-9_]+|CLAUDE_CODE_[A-Z0-9_]+|CLAUDE_CONFIG_DIR|AWS_[A-Z0-9_]+|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLOUD_PROJECT|CLOUD_ML_REGION|VERTEX_REGION_[A-Z0-9_]+)$/i,
  copilot: /^(COPILOT_[A-Z0-9_]+|GH_HOST)$/i,
  codex: /^(CODEX_[A-Z0-9_]+|OPENAI_[A-Z0-9_]+)$/i,
};

/** The variables one adapter's CLI is given; every other one is dropped. */
export function agentEnv(env: Record<string, string | undefined>, adapter: AdapterName): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && (BASE.test(key) || NETWORK.test(key) || OWN[adapter].test(key))) out[key] = value;
  }
  return out;
}
