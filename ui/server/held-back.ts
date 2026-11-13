/**
 * Whether an item is held back from the tune, by the rule toil's ledger uses: the first four bytes of the SHA-256 of its id,
 * as a big-endian number, modulo 3, where zero holds it back. It is written out here because the ledger's own module reads
 * the disk and isn't something this package loads; test/ui-sample-ledger.test.ts, at the repository's root, holds the two
 * equal. Two copies of one rule are two chances to disagree, so there is a test between them and no meeting.
 */

import { createHash } from 'node:crypto';

export const heldBack = (itemId: string): boolean => createHash('sha256').update(itemId, 'utf8').digest().readUInt32BE(0) % 3 === 0;
