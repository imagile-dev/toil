import { alreadyExists, DEFAULT_LIST_LIMIT, forwardSlashes, readFailed, STDIN_OVER_MCP, toCsv, tooManyFiles, type FileAccess } from '../../src/core/files.js';
import { isIgnored, parseIgnore, type IgnoreRule } from '../../src/core/gitignore.js';

/**
 * In-memory files for tests, rooted at `/work`, which is also the workspace.
 * `-` reads `stdin` when one is given. `written` records every write, so a
 * test can assert what landed where. A filing system with no cabinet, and
 * therefore no key to lose.
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
  const isDir = (path: string) => [...store.keys()].some((k) => k.startsWith(`${path === '/' ? '' : path}/`));
  const writeBytes = (path: string, data: Uint8Array) => {
    const target = at(path);
    if (store.has(target)) throw alreadyExists(target);
    store.set(target, data);
    written[target] = data;
    return target;
  };
  return {
    written,
    workspace: cwd,
    resolve: at,
    readText: (path) => new TextDecoder().decode(read(path)),
    readBytes: read,
    writeBytes,
    exists: (path) => store.has(at(path)) || isDir(at(path)),
    stat: (path) => {
      const target = at(path);
      if (store.has(target)) return { type: 'file', size: store.get(target)!.length, modified: '2026-01-01T00:00:00.000Z' };
      if (isDir(target)) return { type: 'directory', size: 0, modified: '2026-01-01T00:00:00.000Z' };
      throw readFailed(path, Object.assign(new Error('missing'), { code: 'ENOENT' }));
    },
    list: (dir = '.', listOptions = {}) => {
      const root = at(dir);
      const under = [...store.keys()].filter((k) => k.startsWith(`${root}/`)).map((k) => k.slice(root.length + 1));
      const gitignore = listOptions.gitignore !== false;
      const rulesFor = (rel: string): IgnoreRule[] => {
        const parts = rel.split('/').slice(0, -1);
        const rules: IgnoreRule[] = [];
        for (let i = 0; i <= parts.length; i++) {
          const base = parts.slice(0, i).join('/');
          const file = store.get(`${root}/${base === '' ? '' : `${base}/`}.gitignore`);
          if (file) rules.push(...parseIgnore(new TextDecoder().decode(file), base));
        }
        return rules;
      };
      const kept = under.filter((rel) => {
        if (rel.split('/').includes('.git')) return false;
        if (!gitignore) return true;
        const rules = rulesFor(rel);
        const parts = rel.split('/');
        // A file inside an ignored folder is ignored, as the real listing never descends into it.
        for (let i = 1; i < parts.length; i++) if (isIgnored(parts.slice(0, i).join('/'), true, rules)) return false;
        return !isIgnored(rel, false, rules);
      });
      const limit = listOptions.limit ?? DEFAULT_LIST_LIMIT;
      if (kept.length > limit) throw tooManyFiles(root, limit);
      return kept.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    },
    findUp: (name, from = '.') => {
      let dir = at(from);
      for (;;) {
        const candidate = dir === '/' ? `/${name}` : `${dir}/${name}`;
        if (store.has(candidate)) return candidate;
        if (dir === cwd || dir === '/') return undefined;
        dir = dir.slice(0, dir.lastIndexOf('/')) || '/';
      }
    },
    writeCsv: (path, header, rows) => writeBytes(path, new TextEncoder().encode(toCsv(header, rows))),
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
