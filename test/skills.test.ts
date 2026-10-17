import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { modules } from '../src/areas.generated.js';
import { commandName } from '../src/core/command.js';
import { envName } from '../src/core/config.js';
import { supportedText, type SupportedVersion } from '../src/core/supported.js';
import { areas, commands } from '../src/registry.js';

/**
 * The skill shipped to users (skills/toil/) is how an agent learns an area
 * exists and how to configure it. SKILL.md is generic on purpose: it names the
 * rule (`<area>.md`, beside it), and each area's file carries its own
 * frontmatter, so twenty integrations never edit one index table. A registered area
 * with no reference file is an area nobody's agent will find. Undocumented
 * capability is, for audit purposes, indistinguishable from no capability.
 */
const dir = join(import.meta.dirname, '..', 'skills', 'toil');
const integrations = join(import.meta.dirname, '..', 'site', 'src', 'data', 'integrations');

/** The `key: value` lines between a file's opening `---` fences. */
export function frontmatter(text: string): Record<string, string> | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) return undefined;
  const out: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const at = line.indexOf(': ');
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 2).trim();
  }
  return out;
}

const supportedOf = new Map(modules.flatMap((m) => (m.area ? [[m.area.name, m.supported] as const] : [])));

describe('shipped skill', () => {
  const index = readFileSync(join(dir, 'SKILL.md'), 'utf8');

  it('SKILL.md names no area list to keep current, only the <area>.md rule', () => {
    expect(index).not.toMatch(/^\| Area \|/m);
    expect(index).toContain('named after it');
  });

  it('every reference file belongs to a registered area', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'SKILL.md');
    expect(files.filter((f) => !areas.some((a) => `${a.name}.md` === f))).toEqual([]);
  });

  for (const area of areas) {
    it(`${area.name}: has skills/toil/${area.name}.md with frontmatter naming the area and what it covers`, () => {
      expect(existsSync(join(dir, `${area.name}.md`)), `add skills/toil/${area.name}.md`).toBe(true);
      const meta = frontmatter(readFileSync(join(dir, `${area.name}.md`), 'utf8'));
      expect(meta?.area, `start skills/toil/${area.name}.md with ---\\narea: ${area.name}\\ndescription: ...\\n---`).toBe(area.name);
      expect(meta?.description ?? '', 'a one-line description of what the area covers').not.toBe('');
      // A colon and a space would make the line a YAML mapping, not a sentence.
      expect(meta?.description ?? '', 'no ": " inside the description').not.toContain(': ');
    });

    it(`${area.name}: its reference names every command and every connection key's env var`, () => {
      const doc = readFileSync(join(dir, `${area.name}.md`), 'utf8');
      for (const def of commands.filter((d) => d.path[0] === area.name)) {
        // In code, either bare (`get-issue`) or in full (`toil jira get-issue`).
        const name = def.path.slice(1).join(' ');
        const named = doc.includes(`\`${name}`) || doc.includes(`\`toil ${def.path.join(' ')}`);
        expect(named, `${commandName(def)} is not named in skills/toil/${area.name}.md`).toBe(true);
      }
      for (const key of Object.keys(area.connection.shape)) {
        expect(doc, `${area.name}.${key}`).toContain(envName(area.name, key));
      }
    });

    it(`${area.name}: its reference names every CI fallback variable it declares`, () => {
      const doc = readFileSync(join(dir, `${area.name}.md`), 'utf8');
      const fallbacks = Object.entries((area.fallbacks ?? {}) as Record<string, string[] | undefined>);
      for (const [key, names] of fallbacks) {
        for (const name of names ?? []) expect(doc, `${area.name}.${key} falls back to ${name}; say so in skills/toil/${area.name}.md`).toContain(name);
      }
    });

    it(`${area.name}: declares its supported versions once, and its skill file and site data say the same`, () => {
      const supported = supportedOf.get(area.name);
      expect(supported, `export const supported: SupportedVersion from src/areas/${area.name}/index.ts`).toBeDefined();
      const doc = readFileSync(join(dir, `${area.name}.md`), 'utf8');
      expect(doc, `skills/toil/${area.name}.md needs a "**Supported versions:**" line`).toContain(`**Supported versions:** ${supportedText(supported!)}`);
      const site = join(integrations, `${area.name}.json`);
      if (existsSync(site)) {
        const data = JSON.parse(readFileSync(site, 'utf8')) as { supported?: SupportedVersion };
        expect(data.supported, `site/src/data/integrations/${area.name}.json "supported"`).toEqual(supported);
      }
    });
  }
});
