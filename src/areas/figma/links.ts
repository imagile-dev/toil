import { ToilError } from '../../core/errors.js';

/**
 * File keys and node IDs, read out of whatever the user pasted: a bare key, a
 * bare node ID, or a Figma link. Pure string work, no network; the link is
 * parsed, never visited. Each rule and message is the canonical
 * implementation's, suspected bugs (#73) included, because a link is a
 * document of record and nobody amends one of those lightly.
 */

const FIX_KEY = 'Pass the file key on its own (the part after /design/, /file/ or /board/ in the link), or a link of the form https://www.figma.com/design/<file-key>/...';
const FIX_NODE = 'Pass a node ID like 12:34 or 12-34, or a Figma link with a node-id query parameter.';

export function isUrl(input: string): boolean {
  return input.startsWith('http://') || input.startsWith('https://');
}

/**
 * The file key from a raw key or a `/design/` or `/file/` link. Anything not
 * starting http(s):// is the key, verbatim. Suspected bugs: a branch link
 * yields the main file's key (#73 item 4), and FigJam `/board/`, `/proto/` and
 * `/slides/` links are refused (#73 item 5).
 */
export function parseFileKey(input: string): string {
  if (isUrl(input)) {
    const match = /figma\.com\/(?:design|file)\/([A-Za-z0-9]+)/i.exec(input);
    if (!match?.[1]) {
      throw new ToilError('INVALID_INPUT', `Could not extract Figma file key from URL: ${input}\nExpected format: https://www.figma.com/design/<file-key>/...`, { fix: FIX_KEY });
    }
    return match[1];
  }
  return input;
}

/** `123:456`, or inside an instance `I123:456;789:012`: `<id>:<id>` segments joined by `;`. */
const NODE_ID_PATTERN = /^[A-Za-z0-9]+:[A-Za-z0-9]+(?:;[A-Za-z0-9]+:[A-Za-z0-9]+)*$/;
const NODE_ID_HINT = 'Expected a node ID like 12:34 or 12-34, or a Figma URL with a node-id query param';

/**
 * A node ID from a raw ID or a link's `node-id` parameter, with dashes turned
 * into the colons the API wants. An explicit value always yields an ID or
 * fails; it never quietly becomes "the whole file".
 */
export function parseNodeId(input: string): string {
  let raw: string | null = input;
  if (isUrl(input)) {
    try {
      raw = new URL(input).searchParams.get('node-id');
    } catch {
      raw = null;
    }
    if (raw === null) {
      throw new ToilError('INVALID_INPUT', `Could not extract a Figma node ID from URL: ${input}\n${NODE_ID_HINT}`, { fix: FIX_NODE });
    }
  }
  const nodeId = raw.trim().replace(/-/g, ':');
  if (!NODE_ID_PATTERN.test(nodeId)) {
    throw new ToilError('INVALID_INPUT', `Invalid Figma node ID: ${input}\n${NODE_ID_HINT}`, { fix: FIX_NODE });
  }
  return nodeId;
}

/**
 * The node ID in a link, if it has one. No `node-id` means the whole file; a
 * `node-id` that's there but malformed still fails. A link the URL parser
 * can't read fails with its own message.
 */
export function findNodeIdInUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (err) {
    throw new ToilError('INVALID_INPUT', err instanceof Error ? err.message : String(err), { fix: FIX_KEY });
  }
  if (!parsed.searchParams.has('node-id')) return undefined;
  return parseNodeId(url);
}
