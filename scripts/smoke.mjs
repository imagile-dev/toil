// Installs the packed tarball the way a locked-down user would (npm, scripts
// off) into a throwaway prefix, then drives the installed bin through both
// front doors: the CLI, and MCP over stdio. Then it clones this checkout and runs
// the committed dist/toil.js with no install, through `setup alias` and a real
// shell. Run after `npm run build`.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// Run npm's own CLI through node: no shell, so nothing is string-concatenated,
// and it works the same on Windows. npm sets npm_execpath under `npm run`.
const npmCli = process.env.npm_execpath;
const runNpm = (args) =>
  npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], { encoding: 'utf8' })
    : spawnSync('npm', args, { encoding: 'utf8' });
const work = mkdtempSync(join(tmpdir(), 'toil-smoke-'));
const fail = (message) => {
  console.error(`smoke: ${message}`);
  process.exitCode = 1;
};

try {
  const packed = runNpm(['pack', '--ignore-scripts', '--pack-destination', work, '--json']);
  if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr}`);
  const tarball = join(work, JSON.parse(packed.stdout)[0].filename);

  const prefix = join(work, 'install');
  const installed = runNpm(['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', tarball]);
  if (installed.status !== 0) throw new Error(`npm install failed: ${installed.stderr}`);
  const bin = join(prefix, 'node_modules', '@imagile-dev', 'toil', 'dist', 'toil.js');

  const envelope = JSON.parse(execFileSync(process.execPath, [bin, 'version'], { encoding: 'utf8' }));
  if (!envelope.ok || typeof envelope.data?.version !== 'string') fail(`toil version returned ${JSON.stringify(envelope)}`);

  // Setup commands from a pipe: no prompt, no hang, an envelope with the env-var fix.
  const configFile = join(work, 'config.json');
  const toil = (...args) => JSON.parse(spawnSync(process.execPath, [bin, '--config', configFile, ...args], { encoding: 'utf8', input: '', timeout: 15000 }).stdout);
  const added = toil('connections', 'add', 'smoke');
  if (added.error?.code !== 'INVALID_INPUT' || !added.error.fix?.includes('TOIL_CONN_SMOKE_AREA')) fail(`connections add without a terminal returned ${JSON.stringify(added)}`);
  const listed = toil('connections', 'list');
  if (!listed.ok || !Array.isArray(listed.data?.connections)) fail(`connections list returned ${JSON.stringify(listed)}`);

  // No git on PATH (CLAUDE.md, No Executables): toil still starts, and a command
  // that runs git answers GIT_NOT_FOUND, exit 1, rather than hanging or crashing.
  const stripped = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH')), PATH: '' };
  const bare = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', input: '', timeout: 15000, env: stripped, cwd: work });
  const started = bare('version');
  if (started.status !== 0 || JSON.parse(started.stdout).ok !== true) fail(`toil version with PATH stripped returned ${started.stdout || started.stderr}`);
  const gitCommands = [['git', 'status']];
  // `--help` on an unknown command prints the root help, so look for the command's own usage line.
  const gitCommand = gitCommands.find((path) => bare(...path, '--help').stdout.includes(`Usage: toil ${path.join(' ')}`));
  let gitStep = 'no command that runs git is registered yet, so only startup was checked with PATH stripped';
  if (gitCommand) {
    const run = bare(...gitCommand);
    const env = JSON.parse(run.stdout || '{}');
    if (run.status !== 1 || env.error?.code !== 'GIT_NOT_FOUND' || !env.error.fix?.includes('PATH searched')) fail(`toil ${gitCommand.join(' ')} with PATH stripped returned ${run.stdout || run.stderr || `signal ${run.signal}`}`);
    gitStep = `toil ${gitCommand.join(' ')} answered GIT_NOT_FOUND with PATH stripped`;
  }

  const { reply, stoppedOnSigint } = await mcpVersion(bin);
  if (reply?.structuredContent?.ok !== true) fail(`MCP tools/call version returned ${JSON.stringify(reply)}`);
  if (!stoppedOnSigint) fail('toil mcp was still running 3s after SIGINT; the first Ctrl+C must stop it.');

  const cloneStep = await fromClone(envelope.data.version);

  if (!process.exitCode) console.log(`smoke ok: installed ${envelope.data.version} with scripts off; CLI, connections and MCP all answered on Node ${process.versions.node} (${process.platform}); ${gitStep}; ${cloneStep}.`);
} catch (err) {
  fail(err.message);
} finally {
  rmSync(work, { recursive: true, force: true });
}

/**
 * The clone path: a fresh clone of this checkout's HEAD has no node_modules and
 * runs the committed dist/toil.js as it is, CLI and MCP, then `setup alias`
 * puts `toil` in a profile and a real shell runs `toil version` through it.
 * It clones the commit, not the working tree, so it tests what a user would
 * get; check:dist is what proves that commit's bundle matches its source.
 */
async function fromClone(installedVersion) {
  const clone = join(work, 'clone');
  const cloned = spawnSync('git', ['clone', '--quiet', '--no-hardlinks', '--', process.cwd(), clone], { encoding: 'utf8' });
  if (cloned.status !== 0) throw new Error(`git clone of this checkout failed: ${cloned.stderr || cloned.error?.message}`);
  const bundle = join(clone, 'dist', 'toil.js');
  if (!existsSync(bundle)) throw new Error('the clone has no dist/toil.js: commit it (npm run build, then git add dist/toil.js).');
  if (existsSync(join(clone, 'node_modules'))) throw new Error('the clone has a node_modules folder, so it would not prove a run with no npm install.');

  const run = (args, options = {}) => spawnSync(process.execPath, [bundle, ...args], { encoding: 'utf8', input: '', timeout: 15000, cwd: clone, ...options });
  const version = JSON.parse(run(['version']).stdout || '{}');
  if (!version.ok || version.data?.version !== installedVersion) fail(`node <clone>/dist/toil.js version returned ${JSON.stringify(version)}, not version ${installedVersion}`);
  const { reply } = await mcpVersion(bundle);
  if (reply?.structuredContent?.ok !== true) fail(`MCP from the clone returned ${JSON.stringify(reply)}`);

  // `setup alias` into a throwaway profile, then each shell this machine has
  // reads that profile and runs `toil version` through the alias. Running the
  // shell is the point here, so it's spawned as the program, with the profile
  // path as an argument rather than spliced into a command string where the
  // shell allows it.
  const shells = [];
  const shellRuns = [];
  const bash = onPath('bash');
  const zsh = onPath('zsh');
  if (bash) {
    shellRuns.push({ shell: 'bash', profile: join(work, 'bashrc'), run: (p) => spawnSync(bash, ['--noprofile', '--norc', '-c', '. "$1" && toil version', 'smoke', p], { encoding: 'utf8', timeout: 15000 }) });
  }
  if (process.platform === 'darwin' && zsh) {
    shellRuns.push({ shell: 'zsh', profile: join(work, 'zshrc'), run: (p) => spawnSync(zsh, ['-f', '-c', '. "$1" && toil version', 'smoke', p], { encoding: 'utf8', timeout: 15000 }) });
  }
  if (process.platform === 'win32') {
    // Invoke-Expression reads the profile's text, so the machine's execution
    // policy, which governs script files, is neither needed nor changed.
    shellRuns.push({
      shell: 'powershell',
      profile: join(work, 'Microsoft.PowerShell_profile.ps1'),
      run: (p) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Invoke-Expression (Get-Content -Raw -LiteralPath '${p.replace(/'/g, "''")}'); toil version`], { encoding: 'utf8', timeout: 30000 }),
    });
  }
  for (const s of shellRuns) {
    const added = JSON.parse(run(['setup', 'alias', '--shell', s.shell, '--profile', s.profile]).stdout || '{}');
    if (added.data?.change !== 'added') {
      fail(`setup alias --shell ${s.shell} returned ${JSON.stringify(added)}`);
      continue;
    }
    const through = s.run(s.profile);
    let answered;
    try {
      answered = JSON.parse(through.stdout.trim().split(/\r?\n/).pop() || '{}');
    } catch {
      answered = undefined;
    }
    if (answered?.ok !== true) fail(`${s.shell} running toil version through the alias printed ${through.stdout || through.stderr || through.error?.message}`);
    const removed = JSON.parse(run(['setup', 'remove-alias', '--shell', s.shell, '--profile', s.profile]).stdout || '{}');
    if (removed.data?.removed !== true || readFileSync(s.profile, 'utf8') !== '') fail(`setup remove-alias --shell ${s.shell} returned ${JSON.stringify(removed)}`);
    shells.push(s.shell);
  }
  if (!shells.length) fail('no shell was found to run the alias in');
  return `a clone ran dist/toil.js with no npm install (CLI and MCP), and ${shells.join(', ')} ran toil through setup alias`;
}

/**
 * The absolute path of `name` on PATH, found without running a shell to ask.
 * On Windows, System32's bash.exe is the WSL launcher, not a bash that can read
 * a Windows path, so it's skipped.
 */
function onPath(name) {
  const exts = process.platform === 'win32' ? ['.exe'] : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir || (process.platform === 'win32' && /[\\/]system32[\\/]?$/i.test(dir))) continue;
    for (const ext of exts) if (existsSync(join(dir, name + ext))) return join(dir, name + ext);
  }
  return undefined;
}

/**
 * Initialize an MCP session over stdio, call the version tool, then send SIGINT
 * and check the server exits, as a user pressing Ctrl+C once expects. (Windows
 * has no real signals, so there it ends the process regardless.)
 */
function mcpVersion(bin) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('MCP server did not answer within 15s'));
    }, 15000);
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (const line of buffer.split('\n').slice(0, -1)) {
        const message = JSON.parse(line);
        if (message.id === 2) {
          clearTimeout(timer);
          const stop = setTimeout(() => {
            child.kill('SIGKILL');
            resolve({ reply: message.result, stoppedOnSigint: false });
          }, 3000);
          child.once('exit', () => {
            clearTimeout(stop);
            resolve({ reply: message.result, stoppedOnSigint: true });
          });
          child.kill('SIGINT');
        }
      }
      buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
    });
    const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'version', arguments: {} } });
  });
}
