// Installs the packed tarball the way a locked-down user would (npm, scripts
// off) into a throwaway prefix, then drives the installed bin through both
// front doors: the CLI, and MCP over stdio. Run after `npm run build`.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

  const { reply, stoppedOnSigint } = await mcpVersion(bin);
  if (reply?.structuredContent?.ok !== true) fail(`MCP tools/call version returned ${JSON.stringify(reply)}`);
  if (!stoppedOnSigint) fail('toil mcp was still running 3s after SIGINT; the first Ctrl+C must stop it.');

  if (!process.exitCode) console.log(`smoke ok: installed ${envelope.data.version} with scripts off; CLI and MCP both answered on Node ${process.versions.node} (${process.platform}).`);
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
