#!/usr/bin/env node
// Makes a release PR's body safe for release-please to read back (#536).
// release-please finds each package's version in the merged release PR's body:
// it parses the notes between the `---` lines as HTML and looks for
// `<details><summary>VERSION</summary>` blocks. A breaking-change note that says
// `TOIL_CONN_<NAME>_*` or `--creator <id>` reads as an unclosed tag there, the
// second `<details>` is swallowed, and release-please skips both packages with
// a warning, no tag and no publish, in a run that still ends green.
//
//   node scripts/release-pr-body.mjs < body.md > escaped.md
//
// It reads the body on stdin, writes it to stdout with every `<` that is not
// one of `<details>`, `</details>`, `<summary>` or `</summary>` written as
// `&amp;lt;`, and says on stderr how many it escaped. Nothing else changes,
// line endings included, and running it twice changes nothing more.
//
// Why `&amp;lt;` and not `&lt;`: release-please parses the body, writes it back
// out from each block's decoded text, and each package's strategy parses it a
// second time. `&lt;` decodes to `<` after the first parse and is a tag again
// in the second; `&amp;lt;` decodes to `&lt;`, survives the second parse as
// text, and ends up as `<` in the notes. The GitHub release notes and CHANGELOG
// read `<NAME>`. The merged PR's own description shows `&lt;` literally on
// GitHub, which is cosmetic. It takes stdin and stdout rather than calling `gh`
// so this script never spawns anything. Escaping the angle brackets by hand in
// every future note would need a change request per bracket; a regex has no
// such backlog.
import { pathToFileURL } from 'node:url';

const TAG_LIKE = /<(?!\/?(?:details|summary)>)/g;

/** The body with every `<` that isn't a details or summary tag written as `&amp;lt;`. */
export const escapeTagLike = (body) => body.replace(TAG_LIKE, '&amp;lt;');

/** How many `<` `escapeTagLike` would escape in the body. */
export const countTagLike = (body) => (body.match(TAG_LIKE) ?? []).length;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const body = await readStdin();
  const count = countTagLike(body);
  process.stdout.write(escapeTagLike(body));
  console.error(count ? `Escaped ${count} tag-like "<" in the release PR body.` : 'Nothing to escape in the release PR body.');
}
