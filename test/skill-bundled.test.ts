import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commandName, type AnyCommand } from '../src/core/command.js';
import type { Envelope } from '../src/core/envelope.js';
import { runCommand } from '../src/core/run.js';
import { createNodeContext } from '../src/node-context.js';
import { areas, commands } from '../src/registry.js';
import { skillFiles } from '../src/skill-pages.generated.js';
import { describeConfig, GENERAL_DESCRIPTION, keepSkillCurrent, skillFilesFor, type SkillDescription } from '../src/skills/bundled.js';
import { readMeta } from '../src/skills/folders.js';
import { testConfig } from './harness/context.js';

/**
 * The toil skill toil installs and keeps current (src/skills/bundled.ts):
 * the size of its index, the generated description, `toil skill install` for
 * every agent and scope, and the two rewrites nobody asks for (a config
 * change, another toil version), run through the real node context against a
 * temp home and repository. Marketplace and hand-made skills sit beside it
 * throughout and must come out byte for byte as they went in.
 */
const AREA_NAMES = areas.map((a) => a.name);

/** The `key: value` lines between a file's opening `---` fences, as an agent host reads them. */
function frontmatter(text: string): Record<string, string> | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) return undefined;
  const out: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const at = line.indexOf(': ');
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 2).trim();
  }
  return out;
}

let root: string;
let home: string;
let repo: string;
let configFile: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'toil-skill-'));
  home = join(root, 'home');
  repo = join(root, 'repo');
  configFile = join(home, '.toil', 'config.json');
  mkdirSync(join(home, '.toil'), { recursive: true });
  mkdirSync(join(repo, '.git'), { recursive: true });
  writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
}

function writeConfig(connections: Record<string, Record<string, unknown>>): void {
  writeFileSync(configFile, `${JSON.stringify({ version: 2, connections, defaults: {} }, null, 2)}\n`);
}

const byName = (name: string): AnyCommand => {
  const def = commands.find((d) => commandName(d) === name);
  if (!def) throw new Error(`no command ${name}`);
  return def;
};

/** One call through the real node context: config from the temp home, env as given, upkeep included. */
async function toil(name: string, input: Record<string, unknown>, env: NodeJS.ProcessEnv = {}, version = '1.0.0'): Promise<Envelope> {
  const def = byName(name);
  return runCommand(
    def,
    input,
    (d) =>
      createNodeContext({
        globals: { workspace: repo },
        def: d,
        signal: new AbortController().signal,
        env,
        cwd: repo,
        home,
        areas,
        version,
        stderr: () => {},
      }),
    version,
  );
}

const warningCodes = (e: Envelope) => (e.meta.warnings ?? []).map((w) => w.code);
const installedIndex = (dir: string) => readFileSync(join(dir, 'toil', 'SKILL.md'), 'utf8');
const descriptionIn = (dir: string) => frontmatter(installedIndex(dir))?.description;

/** A whole folder's files, for byte-for-byte comparison. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, name.name);
      if (name.isDirectory()) walk(path, `${rel}${name.name}/`);
      else out[`${rel}${name.name}`] = readFileSync(path, 'utf8');
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return out;
}

describe('the shipped SKILL.md stays small', () => {
  it('SKILL.md is under 4 KB, so it costs little on every load and the detail stays in the references', () => {
    expect(Buffer.byteLength(skillFiles['SKILL.md']!, 'utf8')).toBeLessThanOrEqual(4096);
  });

  it('installed with every area and engine configured, it is still under 8 KB, and the description under 1,024 characters', () => {
    const d = describeConfig(testConfig({ ...Object.fromEntries(AREA_NAMES.filter((a) => a !== 'db').map((a) => [a, {}])), db: { engine: 'postgres' } }), AREA_NAMES, new Set());
    const index = skillFilesFor(d)['SKILL.md']!;
    expect(Buffer.byteLength(index, 'utf8')).toBeLessThanOrEqual(8192);
    expect(d.description.length).toBeLessThanOrEqual(1024);
  });

  it('every reference file is embedded and installed, so an area set up later is already documented', () => {
    const shipped = readdirSync(join(import.meta.dirname, '..', 'skills', 'toil')).filter((f) => f.endsWith('.md')).sort();
    expect(Object.keys(skillFilesFor(describeConfig(testConfig(), AREA_NAMES, new Set()))).sort()).toEqual(shipped);
  });
});

describe('the generated description', () => {
  const describeOf = (connections: Parameters<typeof testConfig>[0], file: string[] = Object.keys(connections ?? {})): SkillDescription =>
    describeConfig(testConfig(connections), AREA_NAMES, new Set(file));

  it('with nothing configured, is the general one SKILL.md carries', () => {
    const d = describeOf({});
    expect(d).toEqual({ description: GENERAL_DESCRIPTION, areas: [], engines: [], envOnly: [] });
    expect(skillFilesFor(d)['SKILL.md']).toBe(skillFiles['SKILL.md']);
  });

  it('names only the configured areas and database engines, by name: never a host, a user or a secret', () => {
    const d = describeOf({
      jira: { baseUrl: 'https://jira.imagile.dev', apiToken: 'fake-token-abc12345' },
      github: { baseUrl: 'https://ghe.imagile.dev/api/v3', token: 'ghp_fake' },
      db: { engine: 'postgres', host: 'db.imagile.dev', user: 'you', password: 'hunter2' },
    });
    expect(d.areas).toEqual(['github', 'jira']);
    expect(d.engines).toEqual(['postgres']);
    expect(d.description).toContain('(github and jira)');
    expect(d.description).toContain('databases (postgres)');
    expect(d.description).not.toMatch(/imagile\.dev|fake-token|ghp_|hunter2|\byou\b/);
    expect(d.description).not.toMatch(/sonar|confluence/);
    // A plain YAML scalar: no ": " or " #" to turn it into something else.
    expect(d.description).not.toMatch(/: | #/);
    expect(frontmatter(skillFilesFor(d)['SKILL.md']!)?.description).toBe(d.description);
  });

  it('a connection set only by TOIL_* env vars counts, and is reported as env-only', () => {
    const d = describeOf({ jira: { baseUrl: 'https://jira.imagile.dev' }, sonar: { baseUrl: 'https://sonar.imagile.dev' } }, ['jira']);
    expect(d.areas).toEqual(['jira', 'sonar']);
    expect(d.envOnly).toEqual(['sonar']);
  });

  it('a connection to an area toil does not have is not named', () => {
    expect(describeOf({ frobnicator: { baseUrl: 'https://x.imagile.dev' } }).description).toBe(GENERAL_DESCRIPTION);
  });

  it('the installed index lists the configured areas with their references', () => {
    const index = skillFilesFor(describeOf({ jira: {}, db: { engine: 'sqlite' } }))['SKILL.md']!;
    expect(index).toContain('## Configured here');
    expect(index).toMatch(/- `db\.md`: .*Engines set up here: sqlite/);
    expect(index).toMatch(/- `jira\.md`: Issues/);
  });
});

describe('toil skill install', () => {
  const cases = [
    { input: {}, user: '.agents/skills', project: '.agents/skills', agent: 'codex' },
    { input: { agent: 'github-copilot' }, user: '.copilot/skills', project: '.github/skills', agent: 'github-copilot' },
    { input: { claude: true }, user: '.claude/skills', project: '.claude/skills', agent: 'claude-code' },
  ];
  for (const c of cases) {
    for (const scope of ['user', 'project'] as const) {
      it(`${c.agent} at ${scope} scope writes every file to ${scope === 'user' ? '~/' : ''}${scope === 'user' ? c.user : c.project}/toil and records it as bundled`, async () => {
        writeConfig({ 'corp-jira': { area: 'jira', baseUrl: 'https://jira.imagile.dev' } });
        const result = await toil('skill install', { ...c.input, scope, allowWrite: true });
        expect(result.ok, JSON.stringify(result.error)).toBe(true);
        const dir = join(scope === 'user' ? home : repo, scope === 'user' ? c.user : c.project);
        expect((result.data as { path: string }).path).toBe(join(dir, 'toil').replace(/\\/g, '/'));
        expect(readdirSync(join(dir, 'toil')).filter((f) => f.endsWith('.md')).sort()).toEqual(Object.keys(skillFiles).sort());
        expect(descriptionIn(dir)).toContain('(jira)');
        expect(readMeta(dir).skills.toil).toMatchObject({ source: 'bundled', toilVersion: '1.0.0' });
      });
    }
  }

  it('needs --allow-write, and is never an MCP tool', async () => {
    const result = await toil('skill install', {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('WRITE_DISABLED');
    expect(byName('skill install').kind).toBe('cli-only');
    expect(existsSync(join(home, '.agents'))).toBe(false);
  });

  it('says when the description names a connection only env vars define', async () => {
    const result = await toil('skill install', { allowWrite: true }, { TOIL_SONAR_BASE_URL: 'https://sonar.imagile.dev' });
    expect(result.ok).toBe(true);
    expect((result.data as { envOnly: string[]; envNote: string }).envOnly).toEqual(['sonar']);
    expect((result.data as { envNote: string }).envNote).toMatch(/TOIL_\* env vars/);
    expect(warningCodes(result)).toContain('SKILL_ENV_ONLY');
    expect(descriptionIn(join(home, '.agents', 'skills'))).toContain('(sonar)');
  });

  it('refuses a toil folder made by hand or by a marketplace, and leaves it exactly as it was', async () => {
    const skills = join(home, '.agents', 'skills');
    write({
      [join(skills, 'toil', 'SKILL.md')]: '---\nname: toil\ndescription: Mine.\n---\n',
      [join(home, '.claude', 'skills', 'toil', 'SKILL.md')]: '---\nname: toil\ndescription: From a marketplace.\n---\n',
      [join(home, '.claude', 'skills', '.toil-installed.json')]: JSON.stringify({ version: 1, skills: { toil: { source: 'marketplace', marketplace: 'corp', plugin: 'toil', installedAt: '2026-10-01T00:00:00Z' } } }),
    });
    const before = { ...snapshot(join(home, '.agents')), ...snapshot(join(home, '.claude')) };
    for (const input of [{ allowWrite: true }, { claude: true, allowWrite: true }]) {
      const result = await toil('skill install', input);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('INVALID_INPUT');
      expect(result.error?.fix).toMatch(/Move .*toil aside/);
    }
    expect({ ...snapshot(join(home, '.agents')), ...snapshot(join(home, '.claude')) }).toEqual(before);
  });

  it('replaces a copy it installed itself, dropping files the new version no longer has', async () => {
    await toil('skill install', { allowWrite: true });
    const dir = join(home, '.agents', 'skills');
    writeFileSync(join(dir, 'toil', 'retired-area.md'), 'old\n');
    const again = await toil('skill install', { allowWrite: true });
    expect((again.data as { replaced: boolean }).replaced).toBe(true);
    expect(existsSync(join(dir, 'toil', 'retired-area.md'))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.startsWith('.toil-staging') || f.startsWith('.toil-replaced'))).toEqual([]);
  });
});

describe('the installed skill is kept current with no command to run', () => {
  /** A marketplace skill and a hand-made one beside the bundled toil skill, in the same folder. */
  function neighbours(): Record<string, string> {
    const skills = join(home, '.agents', 'skills');
    return {
      [join(skills, 'code-review', 'SKILL.md')]: '---\nname: code-review\ndescription: Reviews.\n---\n',
      [join(skills, 'my-notes', 'SKILL.md')]: '---\nname: my-notes\ndescription: Mine.\n---\n',
    };
  }
  async function installed(): Promise<string> {
    writeConfig({ 'corp-jira': { area: 'jira', baseUrl: 'https://jira.imagile.dev' } });
    const dir = join(home, '.agents', 'skills');
    expect((await toil('skill install', { allowWrite: true })).ok).toBe(true);
    write(neighbours());
    const meta = readMeta(dir);
    meta.skills['code-review'] = { source: 'marketplace', marketplace: 'corp', plugin: 'review', installedAt: '2026-10-01T00:00:00Z' };
    writeFileSync(join(dir, '.toil-installed.json'), JSON.stringify(meta, null, 2));
    return dir;
  }
  const others = (dir: string) => Object.fromEntries(Object.entries(snapshot(dir)).filter(([path]) => path.startsWith('code-review/') || path.startsWith('my-notes/')));

  it('a connection added to the config file rewrites the description on that command, and leaves the other skills alone', async () => {
    const dir = await installed();
    const before = others(dir);
    writeConfig({ 'corp-jira': { area: 'jira', baseUrl: 'https://jira.imagile.dev' }, gh: { area: 'github', baseUrl: 'https://ghe.imagile.dev/api/v3' } });
    // The file changed outside toil, so nothing has noticed yet: a plain read doesn't rewrite on its own.
    const read = await toil('connections list', {});
    expect(warningCodes(read)).not.toContain('SKILL_REWRITTEN');
    expect(descriptionIn(dir)).toContain('(jira)');
    // A command that changes the file does.
    const changed = await toil('connections default', { name: 'gh' });
    expect(changed.ok, JSON.stringify(changed.error)).toBe(true);
    expect(warningCodes(changed)).toContain('SKILL_REWRITTEN');
    expect(descriptionIn(dir)).toContain('(github and jira)');
    expect(others(dir)).toEqual(before);
  });

  it('a connection removed rewrites it too, back to the general description when none is left', async () => {
    const dir = await installed();
    const removed = await toil('connections remove', { name: 'corp-jira' });
    expect(removed.ok, JSON.stringify(removed.error)).toBe(true);
    expect(warningCodes(removed)).toContain('SKILL_REWRITTEN');
    expect(descriptionIn(dir)).toBe(GENERAL_DESCRIPTION);
  });

  it('a skill written by another toil version is rewritten on the next run of any command that loads config, and said in meta.warnings', async () => {
    const dir = await installed();
    const before = others(dir);
    const next = await toil('connections list', {}, {}, '1.1.0');
    expect(next.ok).toBe(true);
    const warning = next.meta.warnings?.find((w) => w.code === 'SKILL_REWRITTEN');
    expect(warning?.message).toMatch(/written by toil 1\.0\.0/);
    expect(readMeta(dir).skills.toil?.toilVersion).toBe('1.1.0');
    expect(others(dir)).toEqual(before);
    // Once rewritten, the same version leaves it alone.
    expect(warningCodes(await toil('connections list', {}, {}, '1.1.0'))).not.toContain('SKILL_REWRITTEN');
  });

  it('different env vars alone never rewrite it: env-only connections count only when the skill is written', async () => {
    const dir = await installed();
    const result = await toil('connections list', {}, { TOIL_SONAR_BASE_URL: 'https://sonar.imagile.dev' });
    expect(warningCodes(result)).not.toContain('SKILL_REWRITTEN');
    expect(descriptionIn(dir)).toContain('(jira)');
  });

  it('never touches a toil folder it did not install, even on a version change', async () => {
    write({ [join(home, '.claude', 'skills', 'toil', 'SKILL.md')]: '---\nname: toil\ndescription: Mine.\n---\n' });
    writeConfig({ 'corp-jira': { area: 'jira', baseUrl: 'https://jira.imagile.dev' } });
    const before = snapshot(join(home, '.claude'));
    await toil('connections default', { name: 'corp-jira' }, {}, '9.9.9');
    expect(snapshot(join(home, '.claude'))).toEqual(before);
  });

  it('a rewrite that fails is a warning, and the config command still succeeds', async () => {
    const dir = await installed();
    // An index that isn't JSON any more: the skill can't be checked, let alone rewritten.
    writeFileSync(join(dir, '.toil-installed.json'), '{ not json');
    const result = await toil('connections default', { name: 'corp-jira' }, {}, '2.0.0');
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(warningCodes(result)).toContain('SKILLS_INDEX_UNREADABLE');
  });

  it('keepSkillCurrent never throws, whatever goes wrong', () => {
    const warnings: string[] = [];
    expect(() =>
      keepSkillCurrent({
        roots: { home, project: undefined },
        version: '1.0.0',
        areas: AREA_NAMES,
        config: testConfig(),
        reload: () => {
          throw new Error('config went away');
        },
        before: 'a',
        read: () => 'b',
        warn: (w) => warnings.push(w.code),
      }),
    ).not.toThrow();
    expect(warnings).toEqual(['SKILL_REWRITE_FAILED']);
  });

  it('a call with --config never rewrites it: the skill describes your own config', async () => {
    const dir = await installed();
    const other = join(root, 'other.json');
    writeFileSync(other, JSON.stringify({ version: 2, connections: { s: { area: 'sonar', baseUrl: 'https://sonar.imagile.dev' } }, defaults: {} }));
    const def = byName('connections list');
    const result = await runCommand(
      def,
      {},
      (d) => createNodeContext({ globals: { workspace: repo, config: other }, def: d, signal: new AbortController().signal, env: {}, cwd: repo, home, areas, version: '3.0.0', stderr: () => {} }),
      '3.0.0',
    );
    expect(warningCodes(result)).not.toContain('SKILL_REWRITTEN');
    expect(readMeta(dir).skills.toil?.toilVersion).toBe('1.0.0');
  });
});

describe('toil skill show', () => {
  it('reports the description it would write and every bundled copy, and whether each is current', async () => {
    writeConfig({ 'corp-jira': { area: 'jira', baseUrl: 'https://jira.imagile.dev' } });
    await toil('skill install', { allowWrite: true });
    await toil('skill install', { agent: 'github-copilot', scope: 'project', allowWrite: true });
    const shown = await toil('skill show', {});
    const data = shown.data as { areas: string[]; installed: Array<{ agent: string; scope: string; current: boolean; stale: boolean }> };
    expect(data.areas).toEqual(['jira']);
    expect(data.installed.map((s) => [s.agent, s.scope, s.current, s.stale])).toEqual([
      ['codex', 'user', true, false],
      ['github-copilot', 'project', true, false],
    ]);
    expect(byName('skill show').kind).toBe('config');
  });
});
