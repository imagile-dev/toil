import { describe, expect, it } from 'vitest';
import { toolName, type AnyCommand } from '../src/core/command.js';
import { areas, commands } from '../src/registry.js';

/**
 * A description that names another tool (`use sonatypeiq_evaluate`) is how an
 * agent finds its next call, so a renamed command must take its mentions with
 * it. This reads every command's text, and every input field's, for tokens that
 * look like one of an area's tool names, and holds each to the registry.
 */

const tools = new Set(commands.map(toolName));
// An area's tool prefix, longest first, so `jira_cloud_` isn't read as `jira_` followed by text.
const prefixes = areas.map((a) => `${a.name.replace(/-/g, '_')}_`).sort((a, b) => b.length - a.length);
const TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/** The tool-shaped tokens in a text whose prefix is an area's. */
function mentions(text: string): string[] {
  return [...text.matchAll(TOKEN)].map((m) => m[0]).filter((t) => prefixes.some((p) => t.startsWith(p)));
}

function texts(def: AnyCommand): string[] {
  const fields = Object.values(def.input.shape as Record<string, { description?: string }>).map((f) => f.description ?? '');
  return [def.description, def.toolDescription ?? '', ...fields];
}

describe('tool names in descriptions', () => {
  it('names only tools that are registered', () => {
    const missing = commands.flatMap((def) => texts(def).flatMap(mentions).filter((t) => !tools.has(t)).map((t) => `${toolName(def)}: ${t}`));
    expect([...new Set(missing)]).toEqual([]);
  });
});
