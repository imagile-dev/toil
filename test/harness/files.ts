import { alreadyExists, forwardSlashes, readFailed, STDIN_OVER_MCP, type FileAccess } from '../../src/core/files.js';

/**
 * In-memory files for tests, rooted at `/work`. `-` reads `stdin` when one is
 * given. `written` records every write, so a test can assert what landed where.
 * A filing system with no cabinet, and therefore no key to lose.
 */
export function memoryFiles(initial: Record<string, string | Uint8Array> = {}, options: { stdin?: string; cwd?: string } = {}): FileAccess & { written: Record<string, Uint8Array> } {
  const cwd = options.cwd ?? '/work';
  const at = (path: string) => {
    const p = forwardSlashes(path);
    if (p.startsWith('/')) return normalise(p);
    return normalise(`${cwd}/${p}`);
  };
  const store = new Map<string, Uint8Array>();
  for (const [path, content] of Object.entries(initial)) store.set(at(path), typeof content === 'string' ? new TextEncoder().encode(content) : content);
  const written: Record<string, Uint8Array> = {};
  const read = (path: string): Uint8Array => {
    if (path === '-') {
      if (options.stdin === undefined) throw STDIN_OVER_MCP;
      return new TextEncoder().encode(options.stdin);
    }
    const found = store.get(at(path));
    if (!found) throw readFailed(path, Object.assign(new Error('missing'), { code: 'ENOENT' }));
    return found;
  };
  return {
    written,
    resolve: at,
    readText: (path) => new TextDecoder().decode(read(path)),
    readBytes: read,
    writeBytes: (path, data) => {
      const target = at(path);
      if (store.has(target)) throw alreadyExists(target);
      store.set(target, data);
      written[target] = data;
      return target;
    },
  };
}

function normalise(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}
