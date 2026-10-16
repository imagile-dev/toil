import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CommanderError } from 'commander';
import { loadConfig } from './core/config.js';
import type { Context } from './core/context.js';
import { createMcpServer } from './mcp/server.js';
import { buildProgram, type GlobalOptions } from './program.js';
import { commands } from './registry.js';
import { VERSION } from './version.js';

function createContext(globals: GlobalOptions): Context {
  return {
    config: loadConfig({ env: process.env, cwd: process.cwd(), home: homedir(), configPath: globals.config }),
    fetch: globalThis.fetch,
    env: process.env,
    version: VERSION,
    dryRun: globals.dryRun === true,
    debug: globals.debug ? (message) => process.stderr.write(`[toil] ${message}\n`) : () => {},
  };
}

const { program, result } = buildProgram({
  commands,
  version: VERSION,
  io: {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    writeFile: (path, content) => writeFileSync(path, content, 'utf8'),
  },
  createContext,
  startMcp: async ({ areas, globals }) => {
    // stdout belongs to the protocol from here on; diagnostics go to stderr.
    const server = createMcpServer({ commands, context: createContext(globals), areas });
    await server.connect(new StdioServerTransport());
  },
});

try {
  await program.parseAsync(process.argv);
  process.exitCode = result.exitCode;
} catch (err) {
  // --help and --version exit through commander with code 0; usage errors with 1.
  process.exitCode = err instanceof CommanderError ? err.exitCode : 1;
  if (!(err instanceof CommanderError)) process.stderr.write(`${(err as Error).message}\n`);
}
