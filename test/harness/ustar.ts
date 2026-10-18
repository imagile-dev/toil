// Builds a ustar archive by hand, so the triage archive reader is tested against
// the format itself rather than one tar's output (and tests need no tar binary).

/** A ustar archive built by hand, so the reader is tested against the format, not one tar's output. */
export function ustar(entries: Array<{ path: string; data?: string; type?: string }>): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? '');
    const header = Buffer.alloc(512);
    const put = (text: string, at: number, length: number) => header.write(text.slice(0, length), at, length, 'utf8');
    const name = entry.path.length > 100 ? entry.path.slice(entry.path.lastIndexOf('/', entry.path.length - 1) + 1) : entry.path;
    const prefix = entry.path.length > 100 ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
    put(name, 0, 100);
    put('0000644\0', 100, 8);
    put('0000000\0', 108, 8);
    put('0000000\0', 116, 8);
    put(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12);
    put('00000000000\0', 136, 12);
    header.write(entry.type ?? '0', 156, 1, 'latin1');
    put('ustar\0', 257, 6);
    put('00', 263, 2);
    put(prefix, 345, 155);
    header.fill(32, 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
