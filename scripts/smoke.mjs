// Installs the packed tarball the way a locked-down user would (npm, scripts
// off) into a throwaway prefix, then drives the installed bin through both
// front doors: the CLI, and MCP over stdio. Run after `npm run build`.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  if (!process.exitCode) console.log(`smoke ok: installed ${envelope.data.version} with scripts off; CLI, connections and MCP all answered, ${lines.length} audit lines written, on Node ${process.versions.node} (${process.platform}); ${gitStep}.`);
} catch (err) {
  fail(err.message);
} finally {
  rmSync(work, { recursive: true, force: true });
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
