// The triage agent's changes travel from its runner as a plain ustar archive
// plus a list of deleted paths. Its runner is not trusted after the agent ran,
// so the jobs downstream read the archive themselves, here, instead of handing
// it to tar: every entry must be a regular file at a path one area may change
// (scripts/triage/changes.mjs), with no links, devices, long-name extensions or
// tricks, before a single byte is written. A parcel is inspected at the door,
// not after it has been signed for and shelved.
//
//   node scripts/triage/archive.mjs check   <changes.tar> <deleted.txt> <area>...
//   node scripts/triage/archive.mjs extract <changes.tar> <deleted.txt> <dest> <area>...
//   → prints the one area changed; exits 1 naming every refused entry

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { check } from './changes.mjs';

const BLOCK = 512;
const MAX_FILE = 1024 * 1024;
const MAX_ENTRIES = 200;

const field = (header, start, length) => {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString('utf8');
};

/** Reads a ustar archive into { files: [{ path, data }], refused: [...] }. Never throws on content. */
export function readUstar(buffer) {
  const files = [];
  const refused = [];
  let offset = 0;
  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const name = field(header, 0, 100);
    const prefix = field(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const type = String.fromCharCode(header[156] || 48);
    const size = parseInt(field(header, 124, 12).trim() || '0', 8);
    const magic = field(header, 257, 6);
    // The stored checksum covers the header with its own field read as spaces.
    const stored = parseInt(field(header, 148, 8).trim() || '-1', 8);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
    if (!magic.startsWith('ustar') || stored !== sum || !Number.isFinite(size) || size < 0) {
      refused.push(`entry at byte ${offset} (not a valid ustar header)`);
      break;
    }
    const data = buffer.subarray(offset + BLOCK, offset + BLOCK + size);
    if (data.length !== size) {
      refused.push(`${path} (truncated)`);
      break;
    }
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === '5') continue; // a directory entry carries nothing; files make their own folders
    if (type !== '0') refused.push(`${path} (type ${type}: only regular files)`);
    else if (size > MAX_FILE) refused.push(`${path} (over 1 MB)`);
    else files.push({ path: path.replace(/^\.\//, ''), data: Buffer.from(data) });
    if (files.length + refused.length > MAX_ENTRIES) {
      refused.push(`more than ${MAX_ENTRIES} entries`);
      break;
    }
  }
  return { files, refused };
}

/** Checks the archive and the deletions against one area's own files. */
export function inspect(buffer, deletedText, areas) {
  const { files, refused } = readUstar(buffer);
  const deleted = deletedText.split('\n').map((line) => line.trim().replace(/^\.\//, '')).filter(Boolean);
  const entries = [...files.map((f) => ({ path: f.path, newMode: '100644' })), ...deleted.map((path) => ({ path, newMode: '000000' }))];
  const result = check(entries, areas);
  return { ...result, ok: result.ok && refused.length === 0, refused: [...refused, ...result.refused], files, deleted };
}

/** Writes the checked files under dest and removes the deleted ones; refuses to write outside dest. */
export function extract(inspected, dest) {
  const root = resolve(dest);
  const inside = (path) => {
    const target = resolve(root, path);
    if (!target.startsWith(root + sep)) throw new Error(`${path} resolves outside ${root}.`);
    return target;
  };
  for (const { path, data } of inspected.files) {
    const target = inside(path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  for (const path of inspected.deleted) rmSync(inside(path), { force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, tar, deleted, ...rest] = process.argv.slice(2);
  if (!['check', 'extract'].includes(command) || !tar || !deleted) {
    console.error('Usage: archive.mjs check <changes.tar> <deleted.txt> <area>... | extract <changes.tar> <deleted.txt> <dest> <area>...');
    process.exit(1);
  }
  const dest = command === 'extract' ? rest.shift() : undefined;
  const read = (path) => {
    try {
      return readFileSync(path);
    } catch {
      return Buffer.alloc(0);
    }
  };
  const result = inspect(read(tar), read(deleted).toString('utf8'), rest);
  if (!result.ok) {
    console.error(`The triage changes include entries triage may not touch:\n${result.refused.map((r) => `  - ${r}`).join('\n')}`);
    process.exit(1);
  }
  if (dest) extract(result, join(dest));
  console.log(result.area);
}
