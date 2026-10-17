import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { AnyCommand } from './core/command.js';
import type { AreaInfo } from './core/config.js';
import type { Context } from './core/context.js';
import { createMcpServer } from './mcp/server.js';
import { createNodeContext } from './node-context.js';
import { runProgram, type GlobalOptions } from './program.js';
import { areas, commands } from './registry.js';
import { VERSION } from './version.js';

const areaInfo: AreaInfo[] = areas.map((a) => ({ name: a.name, fallbacks: a.fallbacks }));

// Ctrl-C cancels the command in flight; execute() turns it into a CANCELLED
// envelope. Installing this listener switches off Node's own exit on SIGINT,
// so anything long-lived (toil mcp) has to exit on it itself.
const interrupt = new AbortController();
process.once('SIGINT', () => interrupt.abort());

const createContext = (globals: GlobalOptions, def?: AnyCommand, signal: AbortSignal = interrupt.signal): Context =>
  createNodeContext({ globals, def, signal, env: process.env, cwd: process.cwd(), home: homedir(), areas: areaInfo, version: VERSION, stderr: (t) => process.stderr.write(t) });

try {
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
        const server = createMcpServer({ commands, context: (def, signal) => createContext(globals, def, signal ?? interrupt.signal), areas });
        process.once('SIGINT', () => {
          void server.close().finally(() => process.exit(130));
        });
        await server.connect(new StdioServerTransport());
      },
    },
    process.argv,
  );
  if (interrupt.signal.aborted) process.exitCode = 130;
} catch (err) {
  process.exitCode = 1;
  process.stderr.write(`${(err as Error).message}\n`);
}
