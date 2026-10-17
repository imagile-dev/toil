import { connectionsOf, connectionWrites, defaultConnectionName, type ResolvedConfig } from '../core/config.js';
import { PALETTE, paint, type TermCaps } from './term.js';

/**
 * What each menu entry shows. Every screen is built from the same code the
 * commands use (config loading, the registry) and has no logic of its own; the
 * menu is a way in, never the only way. Screens are pure: data in, lines out.
 * Unlike the intranet, every page here was generated from something current.
 */

export interface WelcomeData {
  version: string;
  node: string;
  platform: string;
  configPath: string;
  configExists: boolean;
  /** The loaded config, or the error that stopped it loading. */
  config: ResolvedConfig | { error: { code: string; message: string; fix?: string } };
  areas: string[];
  /** How to start toil from a shell: `toil` when installed, `node <path>` from a clone. */
  launch: { command: string; args: string[] };
}

type Caps = Pick<TermCaps, 'colorDepth' | 'unicode'>;

const heading = (caps: Caps, text: string) => paint(caps, PALETTE.amber, text);
const muted = (caps: Caps, text: string) => paint(caps, PALETTE.muted, text);
const faint = (caps: Caps, text: string) => paint(caps, PALETTE.faint, text);
const ok = (caps: Caps, good: boolean, text: string) => paint(caps, good ? PALETTE.amber : PALETTE.accent, text);

function hostOf(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

/** The one-line status under the header on the home screen. */
export function statusLine(caps: Caps, data: WelcomeData): string {
  const dot = caps.unicode ? '·' : '-';
  if ('error' in data.config) return ok(caps, false, `Config needs attention: ${data.config.error.code}`);
  const n = Object.keys(data.config.connections).length;
  const warnings = data.config.warnings.length;
  return [
    muted(caps, `v${data.version}`),
    muted(caps, `${n} connection${n === 1 ? '' : 's'}`),
    warnings ? ok(caps, false, `${warnings} warning${warnings === 1 ? '' : 's'}`) : muted(caps, 'no warnings'),
  ].join(faint(caps, ` ${dot} `));
}

export function healthScreen(caps: Caps, data: WelcomeData): string[] {
  const lines = [
    heading(caps, 'Health check'),
    '',
    `${muted(caps, 'toil      ')} ${data.version}`,
    `${muted(caps, 'Node      ')} ${data.node} on ${data.platform}`,
    `${muted(caps, 'Config    ')} ${data.configPath}${data.configExists ? '' : faint(caps, '  (not created yet)')}`,
    '',
  ];
  if ('error' in data.config) {
    lines.push(ok(caps, false, `${data.config.error.code}: ${data.config.error.message}`));
    if (data.config.error.fix) lines.push(muted(caps, `Fix: ${data.config.error.fix}`));
    return lines;
  }
  const n = Object.keys(data.config.connections).length;
  lines.push(ok(caps, true, `Config loads cleanly. ${n} connection${n === 1 ? '' : 's'}.`));
  if (data.config.warnings.length === 0) lines.push(ok(caps, true, 'No warnings.'));
  for (const w of data.config.warnings) lines.push(ok(caps, false, `${w.code}: ${w.message}`));
  return lines;
}

export function connectionsScreen(caps: Caps, data: WelcomeData): string[] {
  const lines = [heading(caps, 'Connections'), ''];
  if ('error' in data.config) return [...lines, ok(caps, false, 'The config file has a problem; see Health check.')];
  const config = data.config;
  const names = Object.keys(config.connections).sort();
  if (names.length === 0) {
    lines.push(muted(caps, 'No connections yet.'));
    lines.push('');
    lines.push('Set one up with environment variables, for example:');
    lines.push(faint(caps, '  TOIL_JIRA_BASE_URL=https://jira.imagile.dev'));
    lines.push(faint(caps, '  TOIL_JIRA_TOKEN=<your token>'));
  } else {
    const rows = names.map((name) => {
      const c = config.connections[name]!;
      const isDefault = defaultConnectionName(config, c.area) === name;
      const fromEnv = Object.keys(c).some((k) => config.sources[`${name}.${k}`] === 'env' || config.sources[`${name}.${k}`] === 'ci');
      return [
        name + (isDefault && connectionsOf(config, c.area).length > 1 ? ' *' : ''),
        c.area,
        hostOf(c.baseUrl) || faint(caps, '-'),
        connectionWrites(c) ? ok(caps, false, 'writes on') : muted(caps, 'read only'),
        fromEnv ? muted(caps, 'env') : muted(caps, 'file'),
      ];
    });
    const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => stripLen(r[i]!)), 4));
    lines.push(faint(caps, ['NAME'.padEnd(widths[0]!), 'AREA'.padEnd(widths[1]!), 'HOST'.padEnd(widths[2]!), 'WRITES    ', 'FROM'].join('  ')));
    for (const r of rows) lines.push([pad(r[0]!, widths[0]!), pad(r[1]!, widths[1]!), pad(r[2]!, widths[2]!), pad(r[3]!, 10), r[4]].join('  '));
    if (names.some((n) => config.connections[n] && connectionsOf(config, config.connections[n]!.area).length > 1)) {
      lines.push('', faint(caps, '* the default for its area'));
    }
  }
  lines.push('', faint(caps, 'Add one with toil connections add <name>; replace its secret with toil connections login <name>.'));
  return lines;
}

export type AgentClient = 'claude' | 'codex' | 'vscode';

export const AGENT_CLIENTS: Array<{ id: AgentClient; label: string }> = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex CLI' },
  { id: 'vscode', label: 'VS Code (GitHub Copilot)' },
];

/** The config snippet that registers `toil mcp` with an agent client. */
export function agentScreen(caps: Caps, data: WelcomeData, client: AgentClient): string[] {
  const args = [...data.launch.args, 'mcp'];
  const label = AGENT_CLIENTS.find((c) => c.id === client)!.label;
  const lines = [heading(caps, `Connect ${label}`), ''];
  if (client === 'claude') {
    lines.push('Run this once:', '', paint(caps, PALETTE.ink, `  claude mcp add toil -- ${[data.launch.command, ...args].map(shellQuote).join(' ')}`));
  } else if (client === 'codex') {
    lines.push('Add this to ~/.codex/config.toml:', '');
    lines.push(paint(caps, PALETTE.ink, '  [mcp_servers.toil]'));
    lines.push(paint(caps, PALETTE.ink, `  command = ${JSON.stringify(data.launch.command)}`));
    lines.push(paint(caps, PALETTE.ink, `  args = [${args.map((a) => JSON.stringify(a)).join(', ')}]`));
  } else {
    lines.push('Add this to .vscode/mcp.json in your project:', '');
    const json = JSON.stringify({ servers: { toil: { type: 'stdio', command: data.launch.command, args } } }, null, 2);
    for (const l of json.split('\n')) lines.push(paint(caps, PALETTE.ink, `  ${l}`));
  }
  lines.push('', muted(caps, 'To give the agent a smaller set of tools, add --areas after mcp, e.g. --areas jira,confluence.'));
  return lines;
}

export function aboutScreen(caps: Caps, data: WelcomeData): string[] {
  return [
    heading(caps, 'About toil'),
    '',
    'The central integrator between AI agents and the enterprise.',
    'One CLI and MCP server for enterprise tools and databases.',
    'Plain JavaScript on Node: no executables, no install scripts.',
    '',
    `${muted(caps, 'Version   ')} ${data.version}`,
    `${muted(caps, 'Docs      ')} https://imagile-dev.github.io/toil/`,
    `${muted(caps, 'Source    ')} https://github.com/imagile-dev/toil`,
    `${muted(caps, 'Made by   ')} Imagile, https://www.imagile.dev`,
    '',
    faint(caps, `Every command prints one JSON envelope. Try: ${[data.launch.command, ...data.launch.args, 'version', '--pretty'].join(' ')}`),
  ];
}

function shellQuote(arg: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

function stripLen(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - stripLen(text)));
}
