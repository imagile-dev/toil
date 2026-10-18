// Installs the packed tarball the way a locked-down user would (npm, scripts
// off) into a throwaway prefix, then drives the installed bin through both
// front doors: the CLI, and MCP over stdio. Then it clones this checkout and runs
// the bundle from the clone with no install, through `setup alias` and a real
// shell. Run after `npm run build`.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
// A home of its own, so the installed toil's config and audit log land here,
// not in the home of whoever runs the smoke test.
const home = join(work, 'home');
const env = { ...process.env, HOME: home, USERPROFILE: home };
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

  const envelope = JSON.parse(execFileSync(process.execPath, [bin, 'version'], { encoding: 'utf8', env }));
  if (!envelope.ok || typeof envelope.data?.version !== 'string') fail(`toil version returned ${JSON.stringify(envelope)}`);

  // Setup commands from a pipe: no prompt, no hang, an envelope with the env-var fix.
  const configFile = join(work, 'config.json');
  const toil = (...args) => JSON.parse(spawnSync(process.execPath, [bin, '--config', configFile, ...args], { encoding: 'utf8', input: '', timeout: 15000, env }).stdout);
  const added = toil('connections', 'add', 'smoke');
  if (added.error?.code !== 'INVALID_INPUT' || !added.error.fix?.includes('TOIL_CONN_SMOKE_AREA')) fail(`connections add without a terminal returned ${JSON.stringify(added)}`);
  const listed = toil('connections', 'list');
  if (!listed.ok || !Array.isArray(listed.data?.connections)) fail(`connections list returned ${JSON.stringify(listed)}`);

  // The bounded worker (src/areas/util/kit/bounded.ts) from the installed bundle: a
  // document validates in a real worker thread, a backtracking pattern is stopped at
  // its deadline, and with worker threads denied by Node's permission model the
  // check is unchecked with a reason, never a crash.
  const workerStep = boundedWorker(bin);

  // No git on PATH (CLAUDE.md, No Executables): toil still starts, and a command
  // that runs git answers GIT_NOT_FOUND, exit 1, rather than hanging or crashing.
  const stripped = { ...Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== 'PATH')), PATH: '' };
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

  // Every call above, through both front doors, left one line in the audit log.
  const auditDir = join(home, '.toil', 'audit');
  const lines = readdirSync(auditDir).flatMap((f) => readFileSync(join(auditDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const doors = lines.map((l) => `${l.via} ${l.command}`);
  if (!doors.includes('cli version') || !doors.includes('mcp version') || !doors.includes('cli connections list')) fail(`the audit log holds ${JSON.stringify(doors)}`);

  const cloneStep = await fromClone(envelope.data.version);

  if (!process.exitCode) console.log(`smoke ok: installed ${envelope.data.version} with scripts off; CLI, connections and MCP all answered, ${lines.length} audit lines written, on Node ${process.versions.node} (${process.platform}); ${workerStep}; ${gitStep}; ${cloneStep}.`);
} catch (err) {
  fail(err.message);
} finally {
  rmSync(work, { recursive: true, force: true });
}

/**
 * util openapi through the installed bundle, which runs JSON Schema validation
 * and a document's own patterns in a worker thread evaluated from a string
 * inside dist/toil.js. Proves the worker starts from the built bundle (not from
 * source), that a deadline stops it, and that a Node which forbids workers gets
 * an unchecked result rather than a crash.
 */
function boundedWorker(bin) {
  const doc = (sku) => JSON.stringify({ openapi: '3.0.3', info: { title: 'Smoke', version: '1' }, paths: { '/o': { post: { operationId: 'o', requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['sku'], properties: { sku } } } } }, responses: { 200: { description: 'ok' } } } } } });
  const toil = (args, flags = []) => {
    const ran = spawnSync(process.execPath, [...flags, bin, ...args], { encoding: 'utf8', input: '', timeout: 30000, env, cwd: work });
    try {
      return JSON.parse(ran.stdout);
    } catch {
      return { stdout: ran.stdout, stderr: ran.stderr };
    }
  };
  const checkOf = (envelope, name) => envelope.data?.verified?.checks?.find((c) => c.check === name);

  const plain = toil(['util', 'openapi', 'example', '--text', doc({ type: 'string', pattern: '^[A-Z]{3}-\\d+$' }), '--operation', 'o']);
  if (checkOf(plain, 'document.schema')?.status !== 'passed' || checkOf(plain, 'example.valid')?.status !== 'passed' || plain.data?.example?.sku !== 'AAA-0') {
    fail(`util openapi example in a worker returned ${JSON.stringify(plain).slice(0, 600)}`);
  }
  const started = Date.now();
  const stuck = toil(['util', 'openapi', 'example', '--text', doc({ type: 'string', minLength: 41, maxLength: 41, pattern: '(x+)+y' }), '--operation', 'o']);
  const took = Date.now() - started;
  if (!/took longer than 2 s/.test(checkOf(stuck, 'example.patterns')?.detail ?? '') || took > 20000) fail(`a backtracking pattern returned ${JSON.stringify(stuck).slice(0, 600)} after ${took} ms`);
  const denied = toil(['util', 'openapi', 'list', '--text', doc({ type: 'string' })], ['--permission', '--allow-fs-read=*']);
  if (checkOf(denied, 'document.schema')?.status !== 'unchecked' || !/--allow-worker/.test(checkOf(denied, 'document.schema')?.detail ?? '')) fail(`util openapi list with workers denied returned ${JSON.stringify(denied).slice(0, 600)}`);
  return `util openapi validated in a worker from the bundle, a backtracking pattern stopped in ${took} ms, and with workers denied the check came back unchecked`;
}

/**
 * The clone path: a fresh clone of this checkout's HEAD has a committed
 * dist/toil.js and no node_modules, and runs the bundle from there, CLI and
 * MCP; then `setup alias` puts `toil` in a profile and a real shell runs
 * `toil version` through it. The committed bundle is the last release (only
 * the release PR rebuilds it), so the clone runs the bundle just built, put
 * where the committed one sits: this checks the code under test along the
 * path a clone takes. check:dist is what proves the release's own bundle.
 */
async function fromClone(installedVersion) {
  const clone = join(work, 'clone');
  const cloned = spawnSync('git', ['clone', '--quiet', '--no-hardlinks', '--', process.cwd(), clone], { encoding: 'utf8' });
  if (cloned.status !== 0) throw new Error(`git clone of this checkout failed: ${cloned.stderr || cloned.error?.message}`);
  const bundle = join(clone, 'dist', 'toil.js');
  if (!existsSync(bundle)) throw new Error('the clone has no committed dist/toil.js, so a clone could not run toil.');
  copyFileSync(join(process.cwd(), 'dist', 'toil.js'), bundle);
  if (existsSync(join(clone, 'node_modules'))) throw new Error('the clone has a node_modules folder, so it would not prove a run with no npm install.');

  const run = (args, options = {}) => spawnSync(process.execPath, [bundle, ...args], { encoding: 'utf8', input: '', timeout: 15000, cwd: clone, env, ...options });
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
    shellRuns.push({ shell: 'bash', profile: join(work, 'bashrc'), run: (p) => spawnSync(bash, ['--noprofile', '--norc', '-c', '. "$1" && toil version', 'smoke', p], { encoding: 'utf8', timeout: 15000, env }) });
  }
  if (process.platform === 'darwin' && zsh) {
    shellRuns.push({ shell: 'zsh', profile: join(work, 'zshrc'), run: (p) => spawnSync(zsh, ['-f', '-c', '. "$1" && toil version', 'smoke', p], { encoding: 'utf8', timeout: 15000, env }) });
  }
  if (process.platform === 'win32') {
    // Invoke-Expression reads the profile's text, so the machine's execution
    // policy, which governs script files, is neither needed nor changed.
    shellRuns.push({
      shell: 'powershell',
      profile: join(work, 'Microsoft.PowerShell_profile.ps1'),
      run: (p) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Invoke-Expression (Get-Content -Raw -LiteralPath '${p.replace(/'/g, "''")}'); toil version`], { encoding: 'utf8', timeout: 30000, env }),
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
    const child = spawn(process.execPath, [bin, 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'], env });
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
