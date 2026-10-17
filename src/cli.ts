import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { AnyCommand } from './core/command.js';
import type { AreaInfo } from './core/config.js';
import type { Context } from './core/context.js';
import { createSecretStore } from './core/keychain.js';
import { terminalPrompter } from './core/prompt.js';
import { createMcpServer } from './mcp/server.js';
import { createNodeContext } from './node-context.js';
import { runProgram, type GlobalOptions } from './program.js';
import { areas, commands } from './registry.js';
import { VERSION } from './version.js';
import { gatherWelcomeData } from './welcome/data.js';
import { runWelcome, wantsWelcome } from './welcome/index.js';

const areaInfo: AreaInfo[] = areas.map((a) => ({ name: a.name, fallbacks: a.fallbacks }));

// Ctrl-C cancels the command in flight; execute() turns it into a CANCELLED
// envelope. Installing this listener switches off Node's own exit on SIGINT,
// so anything long-lived (toil mcp) has to exit on it itself.
const interrupt = new AbortController();
process.once('SIGINT', () => interrupt.abort());

// Nothing is spawned until a `keychain:` reference is actually read.
const secrets = createSecretStore();
// Setup commands may ask questions, only of a person at a terminal. MCP never gets a prompter.
const prompt = process.stdin.isTTY && process.stderr.isTTY ? terminalPrompter(process.stdin, process.stderr) : undefined;

const createContext = (globals: GlobalOptions, def?: AnyCommand, signal: AbortSignal = interrupt.signal, mcp = false, roots?: readonly string[]): Context =>
  createNodeContext({
    globals,
    def,
    signal,
    // Under `toil mcp` stdin carries the protocol, so `-` can't mean it, and
    // the workspace comes from the flag, the env or the client's one root.
    stdin: !mcp,
    roots,
    env: process.env,
    cwd: process.cwd(),
    home: homedir(),
    areas: areaInfo,
    version: VERSION,
    stderr: (t) => process.stderr.write(t),
    secrets,
    prompt: mcp ? undefined : prompt,
  });

try {
  if (wantsWelcome(process.argv.slice(2), process.stdin, process.stdout, process.env)) {
    const data = gatherWelcomeData({ version: VERSION, env: process.env, cwd: process.cwd(), home: homedir(), areas: areaInfo, script: process.argv[1] });
    const ended = await runWelcome({ input: process.stdin, output: process.stdout, env: process.env }, data);
    if (ended === 'interrupted') process.exitCode = 130;
  } else {
    process.exitCode = await runProgram(
    {
      commands,
      version: VERSION,
      io: {
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
        writeFile: (path, content) => writeFileSync(path, content, 'utf8'),
      },
      createContext: (globals, def) => createContext(globals, def),
      startMcp: async ({ areas, globals }) => {
        // stdout belongs to the protocol from here on; diagnostics go to stderr.
        // Each tool call gets its own context, cancelled by the client's own signal.
        const server = createMcpServer({ commands, context: (def, signal, roots) => createContext(globals, def, signal ?? interrupt.signal, true, roots), areas });
        process.once('SIGINT', () => {
          void server.close().finally(() => process.exit(130));
        });
        await server.connect(new StdioServerTransport());
      },
    },
    process.argv,
  );
  }
  if (interrupt.signal.aborted) process.exitCode = 130;
} catch (err) {
  process.exitCode = 1;
  process.stderr.write(`${(err as Error).message}\n`);
}
