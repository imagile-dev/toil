import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commandName } from '../src/core/command.js';
import { envName } from '../src/core/config.js';
import { areas, commands } from '../src/registry.js';

/**
 * The skill shipped to users (skills/toil/) is how an agent learns an area
 * exists and how to configure it. A registered area with no reference file,
 * or no row in the index, is an area nobody's agent will find. Undocumented
 * capability is, for audit purposes, indistinguishable from no capability.
 */
const dir = join(import.meta.dirname, '..', 'skills', 'toil');

describe('shipped skill', () => {
  const index = readFileSync(join(dir, 'SKILL.md'), 'utf8');

  for (const area of areas) {
    it(`${area.name}: has skills/toil/${area.name}.md and a row in SKILL.md`, () => {
      expect(existsSync(join(dir, `${area.name}.md`)), `add skills/toil/${area.name}.md`).toBe(true);
      expect(index, `add a ${area.name} row to skills/toil/SKILL.md`).toContain(`| \`${area.name}\` |`);
    });

    it(`${area.name}: its reference names every command and every connection key's env var`, () => {
      const doc = readFileSync(join(dir, `${area.name}.md`), 'utf8');
      for (const def of commands.filter((d) => d.path[0] === area.name)) {
        expect(doc, commandName(def)).toContain(`\`${def.path.slice(1).join(' ')}`);
      }
      for (const key of Object.keys(area.connection.shape)) {
        expect(doc, `${area.name}.${key}`).toContain(envName(area.name, key));
      }
    });
  }
});
