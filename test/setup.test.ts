import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forwardSlashes } from '../src/core/files.js';
import { aliasBlock, BEGIN, END, pickShell, profileFor, withBlock, withoutBlock, type SetupHost } from '../src/core/shell-profile.js';
import { setupCommands } from '../src/setup/commands.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';

/**
 * `toil setup alias | remove-alias` against profiles in a temp home. The
 * block itself is run by a real shell in scripts/smoke.mjs, on every OS in CI.
 * No real dotfile is harmed, or consulted, in the making of these tests.
 */
let root: string;
let home: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'toil-setup-'));
  home = join(root, 'home');
  mkdirSync(home, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const BUNDLE = '/opt/clones/toil/dist/toil.js';
const host = (over: Partial<SetupHost> = {}): SetupHost => ({ platform: 'linux', home, cwd: root, env: { SHELL: '/bin/bash' }, bundle: BUNDLE, ...over });
const cli = (argv: string[], over: Partial<SetupHost> = {}) => {
  const { context } = testContext();
  context.config.files.global = join(home, '.toil', 'config.json');
  return runCli(argv, { commands: setupCommands(() => host(over)), context });
};

describe('the alias block', () => {
  it('is a bash/zsh function passing every argument, with the path single-quoted', () => {
    expect(aliasBlock('bash', "/home/o'neil/toil/dist/toil.js")).toBe(
      `${BEGIN}\n# Added by \`toil setup alias\`; \`toil setup remove-alias\` takes it out.\ntoil() { node '/home/o'\\''neil/toil/dist/toil.js' "$@"; }\n${END}\n`,
    );
  });

  it('is a PowerShell function splatting @args, with single quotes doubled', () => {
    expect(aliasBlock('powershell', "C:\\Users\\o'neil\\toil\\dist\\toil.js")).toContain("function toil { node 'C:\\Users\\o''neil\\toil\\dist\\toil.js' @args }");
  });

  it('is appended after a final newline, left alone when current, and replaced in place when not', () => {
    const block = aliasBlock('bash', BUNDLE);
    const added = withBlock('export A=1', block, 'p');
    expect(added).toEqual({ text: `export A=1\n${block}`, change: 'added' });
    expect(withBlock(added.text, block, 'p')).toEqual({ text: added.text, change: 'unchanged' });
    const moved = withBlock(`${added.text}export B=2\n`, aliasBlock('bash', '/elsewhere/toil.js'), 'p');
    expect(moved.change).toBe('updated');
    expect(moved.text).toBe(`export A=1\n${aliasBlock('bash', '/elsewhere/toil.js')}export B=2\n`);
  });

  it('reads a CRLF profile, keeps its other lines as they were, and comes out again cleanly', () => {
    const before = 'line one\r\nline two\r\n';
    const block = aliasBlock('powershell', 'C:\\toil\\dist\\toil.js');
    const added = withBlock(before, block, 'p').text;
    expect(withBlock(added.replace(block, block.replace(/\n/g, '\r\n')), block, 'p').change).toBe('unchanged');
    expect(withoutBlock(added, 'p')).toEqual({ text: before, removed: true });
    expect(withoutBlock(before, 'p')).toEqual({ text: before, removed: false });
  });

  it('finds its block when an editor indented the markers, rather than adding a second', () => {
    const indented = `x\n  ${BEGIN}\ntoil() { old; }\n  ${END}  \ny\n`;
    expect(withoutBlock(indented, 'p')).toEqual({ text: 'x\ny\n', removed: true });
    expect(withBlock(indented, aliasBlock('bash', BUNDLE), 'p')).toEqual({ text: `x\n${aliasBlock('bash', BUNDLE)}y\n`, change: 'updated' });
  });

  it('refuses a profile whose markers do not pair up, rather than guess which lines are its own', () => {
    expect(() => withBlock(`${BEGIN}\nsomething of yours\n`, aliasBlock('bash', BUNDLE), 'p')).toThrow(/can't tell which lines are its own/);
    // One of each, end before start: no block, so adding one would leave two of each.
    expect(() => withBlock(`${END}\nx\n${BEGIN}\n`, aliasBlock('bash', BUNDLE), 'p')).toThrow(/can't tell which lines are its own/);
    expect(() => withoutBlock(`${END}\nx\n${BEGIN}\n`, 'p')).toThrow(/can't tell which lines are its own/);
    expect(() => withoutBlock(`${aliasBlock('bash', BUNDLE)}${aliasBlock('bash', BUNDLE)}`, 'p')).toThrow(/2 "# >>> toil alias >>>" line/);
  });
});

describe('which shell and which profile', () => {
  it('takes --shell, then a .ps1 --profile, then SHELL (bash.exe included), then PowerShell on Windows', () => {
    expect(pickShell('zsh', undefined, host())).toBe('zsh');
    expect(pickShell(undefined, 'C:/x/Microsoft.PowerShell_profile.ps1', host())).toBe('powershell');
    expect(pickShell(undefined, undefined, host({ env: { SHELL: '/usr/bin/bash.exe' } }))).toBe('bash');
    expect(pickShell(undefined, undefined, host({ env: { SHELL: '/bin/zsh' } }))).toBe('zsh');
    expect(pickShell(undefined, undefined, host({ platform: 'win32', env: {} }))).toBe('powershell');
    expect(() => pickShell(undefined, undefined, host({ env: { SHELL: '/usr/bin/fish' } }))).toThrow(/SHELL is "fish"/);
    expect(() => pickShell(undefined, undefined, host({ env: {} }))).toThrow(/SHELL is not set/);
  });

  it('uses ~/.bashrc, $ZDOTDIR/.zshrc, and asks PowerShell for $PROFILE', () => {
    expect(profileFor('bash', host())).toBe(join(home, '.bashrc'));
    expect(profileFor('zsh', host())).toBe(join(home, '.zshrc'));
    expect(profileFor('zsh', host({ env: { ZDOTDIR: join(home, 'z') } }))).toBe(join(home, 'z', '.zshrc'));
    expect(() => profileFor('powershell', host())).toThrow(/folder toil can't work out/);
  });
});

describe('toil setup alias / remove-alias', () => {
  it('adds the block to ~/.bashrc, keeps what was there, is idempotent, and remove-alias restores the file', async () => {
    const bashrc = join(home, '.bashrc');
    writeFileSync(bashrc, '# mine\nexport EDITOR=vi\n');
    const first = await cli(['setup', 'alias']);
    expect(first.envelope).toMatchObject({
      ok: true,
      data: { shell: 'bash', profile: forwardSlashes(bashrc), bundle: BUNDLE, change: 'added', next: `Open a new terminal, or run . '${forwardSlashes(bashrc)}', then run toil version.` },
    });
    expect(readFileSync(bashrc, 'utf8')).toBe(`# mine\nexport EDITOR=vi\n${aliasBlock('bash', BUNDLE)}`);

    expect((await cli(['setup', 'alias'])).envelope?.data).toMatchObject({ change: 'unchanged' });
    const removed = await cli(['setup', 'remove-alias']);
    expect(removed.envelope).toMatchObject({ ok: true, data: { shell: 'bash', removed: true } });
    expect(readFileSync(bashrc, 'utf8')).toBe('# mine\nexport EDITOR=vi\n');
    expect((await cli(['setup', 'remove-alias'])).envelope?.data).toMatchObject({ removed: false });
  });

  it('creates a profile that does not exist yet, and remove-alias leaves a missing one missing', async () => {
    const profile = join(root, 'ps', 'Microsoft.PowerShell_profile.ps1');
    expect((await cli(['setup', 'remove-alias', '--profile', profile])).envelope?.data).toMatchObject({ shell: 'powershell', removed: false });
    expect(existsSync(profile)).toBe(false);
    const run = await cli(['setup', 'alias', '--profile', profile], { bundle: 'C:\\toil\\dist\\toil.js' });
    expect(run.envelope?.data).toMatchObject({ shell: 'powershell', change: 'added', bundle: 'C:/toil/dist/toil.js' });
    expect(readFileSync(profile, 'utf8')).toBe(aliasBlock('powershell', 'C:\\toil\\dist\\toil.js'));
  });

  it('keeps a UTF-8 byte-order mark, and refuses a UTF-16 profile untouched', async () => {
    const withBom = join(root, 'bom.ps1');
    writeFileSync(withBom, '\uFEFFSet-Alias ll Get-ChildItem\r\n', 'utf8');
    await cli(['setup', 'alias', '--profile', withBom]);
    expect(readFileSync(withBom, 'utf8').startsWith('\uFEFFSet-Alias ll Get-ChildItem\r\n# >>> toil alias >>>')).toBe(true);

    const utf16 = join(root, 'wide.ps1');
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Set-Alias ll Get-ChildItem', 'utf16le')]);
    writeFileSync(utf16, bytes);
    const run = await cli(['setup', 'alias', '--profile', utf16]);
    expect(run.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('UTF-16') });
    expect(readFileSync(utf16).equals(bytes)).toBe(true);
  });

  it("refuses toil's own config folder and the --config file as a profile", async () => {
    for (const profile of [join(home, '.toil', 'profile.sh'), join(home, '.toil', 'config.json')]) {
      const run = await cli(['setup', 'alias', '--shell', 'bash', '--profile', profile]);
      expect(run.envelope?.error?.code, profile).toBe('INVALID_INPUT');
      expect(run.envelope?.error?.message).toContain("toil's own configuration");
      expect(existsSync(profile)).toBe(false);
    }
  });

  it('refuses a toil that npm installed, which is already on PATH', async () => {
    const run = await cli(['setup', 'alias'], { bundle: '/usr/lib/node_modules/@imagile-dev/toil/dist/toil.js' });
    expect(run.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('installed by npm') });
    expect(existsSync(join(home, '.bashrc'))).toBe(false);
  });

  it('needs --profile for PowerShell, and names the command to run', async () => {
    const run = await cli(['setup', 'alias', '--shell', 'powershell']);
    expect(run.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', fix: `In the PowerShell you use, run: node '${BUNDLE}' setup alias --profile $PROFILE` });
  });

  it('refuses a shell it does not set up', async () => {
    const run = await cli(['setup', 'alias', '--shell', 'fish']);
    expect(run.envelope?.error?.code).toBe('INVALID_INPUT');
  });

  // Creating a symlink on Windows needs Developer Mode or admin rights, which CI's runner may not have.
  it.skipIf(process.platform === 'win32')('writes through a profile that is a symlink, leaving the link in place (skipped on Windows: symlinks need extra rights there)', async () => {
    const real = join(root, 'dotfiles', 'bashrc');
    mkdirSync(join(root, 'dotfiles'));
    writeFileSync(real, 'export A=1\n');
    symlinkSync(real, join(home, '.bashrc'));
    await cli(['setup', 'alias']);
    expect(lstatSync(join(home, '.bashrc')).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toBe(`export A=1\n${aliasBlock('bash', BUNDLE)}`);
  });
});
