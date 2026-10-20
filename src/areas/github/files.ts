import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { githubArea } from './area.js';
import { github, target } from './client.js';

/**
 * One file from a repository, read through the contents API: GitHub's own
 * record, plus its text decoded. Toil UI reads a repository's CODEOWNERS
 * with it to suggest reviewers (#291). The file is read, never written,
 * which is the only safe thing to do with a CODEOWNERS file anyway.
 */

/** Files GitHub's contents API inlines: above this it sends no content, and the text is left out with a warning. */
const MAX_INLINE = 1024 * 1024;

interface Contents {
  type?: string;
  encoding?: string;
  content?: string;
  size?: number;
  path?: string;
}

export const repoFileCommand = githubArea.command({
  path: ['github', 'repo', 'file'],
  description: 'Read one file from a repository',
  toolDescription:
    "Reads one file from the repository through GitHub's contents API, at ref (a branch, tag or commit; the default branch without it). Returns GitHub's record (name, path, sha, size, type, encoding, content as base64, html_url) plus text, the content decoded as UTF-8; text is null, with a warning, for a file over 1 MB, which GitHub doesn't inline. A folder is refused: name a file.",
  input: z.object({
    path: z.string().min(1).describe('The file\'s path in the repository, such as .github/CODEOWNERS'),
    ref: z.string().min(1).optional().describe('A branch, tag or commit (default: the default branch)'),
  }),
  writes: false,
  args: [{ name: 'path', field: 'path', description: "The file's path in the repository" }],
  options: [{ flags: '--ref <ref>', field: 'ref', description: 'A branch, tag or commit (default: the default branch)' }],
  examples: [{ owner: 'imagile', repo: 'toil-probe', path: '.github/CODEOWNERS' }, { owner: 'imagile', repo: 'toil-probe', path: 'docs/CODEOWNERS', ref: 'release/1.4' }],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    const path = input.path.replace(/^\/+/, '');
    const encoded = path.split('/').map((part) => {
      if (part === '.' || part === '..' || part === '') throw new ToilError('INVALID_INPUT', `"${input.path}" isn't a file path in the repository.`, { fix: 'Name the file from the repository root, with no . or .. parts: .github/CODEOWNERS.' });
      return encodeURIComponent(part);
    });
    const body = await github<Contents | Contents[]>(ctx, `/repos/${owner}/${repo}/contents/${encoded.join('/')}`, { query: input.ref ? { ref: input.ref } : {} });
    if (Array.isArray(body) || body.type !== 'file') {
      throw new ToilError('INVALID_INPUT', `${path} in ${owner}/${repo} is ${Array.isArray(body) ? 'a folder' : `a ${body.type ?? 'thing'}`}, not a file.`, { fix: 'Name a file in it: github repo file <folder>/<file>.' });
    }
    if (body.encoding !== 'base64' || typeof body.content !== 'string' || (body.size ?? 0) > MAX_INLINE) {
      ctx.warn({ code: 'GITHUB_FILE_NOT_INLINED', message: `${path} is ${body.size ?? 'of unknown'} bytes, and GitHub sends no content above 1 MB, so text is null.` });
      return { ...body, text: null };
    }
    return { ...body, text: Buffer.from(body.content, 'base64').toString('utf8') };
  },
});

export const fileCommands = [repoFileCommand];
