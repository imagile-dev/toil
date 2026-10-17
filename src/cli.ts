import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { areaOf } from './core/command.js';
import { loadConfig } from './core/config.js';
import type { Context } from './core/context.js';
import { createMcpServer } from './mcp/server.js';
import { runProgram, type GlobalOptions } from './program.js';
import { commands } from './registry.js';
import { VERSION } from './version.js';

const knownAreas = [...new Set(commands.map(areaOf))];

function createContext(globals: GlobalOptions): Context {
  return {
    config: loadConfig({ env: process.env, cwd: process.cwd(), home: homedir(), configPath: globals.config, knownAreas }),
    fetch: globalThis.fetch,
    env: process.env,
    version: VERSION,
    dryRun: globals.dryRun === true,
    verbose: globals.verbose === true,
    debug: globals.debug ? (message) => process.stderr.write(`[toil] ${message}\n`) : () => {},
  };
}

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
      createContext,
      startMcp: async ({ areas, globals }) => {
        // stdout belongs to the protocol from here on; diagnostics go to stderr.
        const server = createMcpServer({ commands, context: createContext(globals), areas });
        await server.connect(new StdioServerTransport());
      },
    },
    process.argv,
  );
} catch (err) {
  process.exitCode = 1;
  process.stderr.write(`${(err as Error).message}\n`);
}
