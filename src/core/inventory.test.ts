import { describe, expect, it } from 'vitest';
import { memoryFiles } from '../../test/harness/files.js';
import { readInventory } from './inventory.js';

const pkg = { name: 'left-pad', version: '1.3.0', ecosystem: 'npm', type: 'direct', scope: 'prod', source: 'package-lock.json' };

describe('the shared inventory reader', () => {
  it("reads deps scan's envelope, its data, or a bare list, from a file or stdin", () => {
    const shapes = [{ ok: true, data: { packages: [pkg] } }, { packages: [pkg] }, [pkg]];
    for (const shape of shapes) {
      expect(readInventory({ files: memoryFiles({ 'inv.json': JSON.stringify(shape) }) }, 'inv.json')).toEqual([pkg]);
      expect(readInventory({ files: memoryFiles({}, { stdin: JSON.stringify(shape) }) }, undefined)).toEqual([pkg]);
    }
  });

  it('refuses what is not an inventory, naming where it came from and the command to pipe into', () => {
    const read = (text: string, pipeTo?: string) => () => readInventory({ files: memoryFiles({}, { stdin: text }) }, '-', pipeTo ? { pipeTo } : {});
    expect(read('nope')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: "The inventory from stdin isn't JSON.", fix: expect.stringContaining('toil deps scan | toil <command>') }));
    expect(read('{}', 'toil osv vulns')).toThrow(expect.objectContaining({ message: 'The inventory from stdin has no packages list.', fix: expect.stringContaining('toil deps scan | toil osv vulns') }));
    expect(read('{"ok":false,"error":{"message":"No repo."}}')).toThrow(expect.objectContaining({ message: 'The inventory from stdin is a failed result: No repo..' }));
    expect(read('[{"name":"x","ecosystem":"npm"}]')).toThrow(expect.objectContaining({ message: 'The inventory from stdin has a package without a usable version (packages[0]).' }));
  });

  it('says there is no stdin over MCP when from is left out', () => {
    expect(() => readInventory({ files: memoryFiles() }, undefined)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('Over MCP there is no stdin') }));
  });
});
