/**
 * Just enough DER to read what `node:crypto`'s X509Certificate doesn't
 * expose: the key usage bits, the basic constraints' path length, and the
 * outline of a certificate (its length, its serial, its extensions). It
 * reads definite lengths only, as DER requires, and never builds anything.
 * A full ASN.1 library would read every structure ever standardised; this
 * reads the four this command was asked about, which is the amount of
 * standard anyone has been asked about.
 */

export class DerError extends Error {}

/** One tag-length-value: the tag byte, where its content starts and where the whole element ends. */
export interface Tlv {
  tag: number;
  /** Where the element's header starts. */
  start: number;
  /** Where its content starts. */
  content: number;
  /** One past its last byte. */
  end: number;
}

/** The element at `offset`, which must end at or before `limit`. */
export function readTlv(bytes: Uint8Array, offset: number, limit = bytes.length): Tlv {
  if (offset + 2 > limit) throw new DerError(`the data ends at byte ${limit}, inside an element header`);
  const tag = bytes[offset]!;
  if ((tag & 0x1f) === 0x1f) throw new DerError(`byte ${offset} starts a multi-byte tag, which certificates don't use`);
  const first = bytes[offset + 1]!;
  let content = offset + 2;
  let length = first;
  if (first === 0x80) throw new DerError(`byte ${offset} starts an element of indefinite length, which DER doesn't allow`);
  if (first > 0x80) {
    const count = first & 0x7f;
    if (count > 4) throw new DerError(`byte ${offset} starts an element too long to be a certificate's`);
    if (content + count > limit) throw new DerError(`the data ends at byte ${limit}, inside an element header`);
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + bytes[content + i]!;
    content += count;
  }
  const end = content + length;
  if (end > limit) throw new DerError(`the element at byte ${offset} says it is ${length} bytes long, but only ${limit - content} follow`);
  return { tag, start: offset, content, end };
}

/** The elements inside a constructed element, which must fill it exactly. */
export function children(bytes: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let at = parent.content; at < parent.end; ) {
    const child = readTlv(bytes, at, parent.end);
    out.push(child);
    at = child.end;
  }
  return out;
}

/** An OBJECT IDENTIFIER's content as dotted text. */
export function oidText(bytes: Uint8Array, tlv: Tlv): string {
  if (tlv.tag !== 0x06) throw new DerError(`expected an object identifier at byte ${tlv.start}`);
  const parts: number[] = [];
  let value = 0;
  for (let i = tlv.content; i < tlv.end; i++) {
    value = value * 128 + (bytes[i]! & 0x7f);
    if ((bytes[i]! & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  if (parts.length === 0) throw new DerError(`the object identifier at byte ${tlv.start} is empty`);
  const head = parts[0]!;
  const first = head < 40 ? 0 : head < 80 ? 1 : 2;
  return [first, head - first * 40, ...parts.slice(1)].join('.');
}

/** An INTEGER as OpenSSL prints a serial: upper-case hex, without the sign byte, `-` before a negative one. */
export function integerHex(bytes: Uint8Array, tlv: Tlv): string {
  if (tlv.tag !== 0x02) throw new DerError(`expected an integer at byte ${tlv.start}`);
  let raw = Buffer.from(bytes.subarray(tlv.content, tlv.end));
  if (raw.length === 0) throw new DerError(`the integer at byte ${tlv.start} is empty`);
  const negative = (raw[0]! & 0x80) !== 0;
  if (negative) {
    // Two's complement: invert and add one to get the magnitude.
    raw = Buffer.from(raw.map((b) => ~b & 0xff));
    for (let i = raw.length - 1; i >= 0; i--) {
      raw[i] = (raw[i]! + 1) & 0xff;
      if (raw[i] !== 0) break;
    }
  }
  let start = 0;
  while (start < raw.length - 1 && raw[start] === 0) start++;
  return `${negative ? '-' : ''}${raw.subarray(start).toString('hex').toUpperCase()}`;
}

export const KEY_USAGE_BITS = ['digitalSignature', 'nonRepudiation', 'keyEncipherment', 'dataEncipherment', 'keyAgreement', 'keyCertSign', 'cRLSign', 'encipherOnly', 'decipherOnly'] as const;

export interface DerCertificate {
  /** The certificate's own bytes, which may be fewer than were given (see {@link certificateAt}). */
  end: number;
  serial: string;
  /** The extensions by OID, with whether each is critical. */
  extensions: Map<string, { critical: boolean; value: Tlv }>;
  /** Key usage bit names, or undefined without the extension. */
  keyUsage: string[] | undefined;
  /** Basic constraints, or undefined without the extension. */
  basicConstraints: { ca: boolean; pathLength: number | null } | undefined;
}

const OID_KEY_USAGE = '2.5.29.15';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';

function keyUsage(bytes: Uint8Array, octet: Tlv): string[] {
  const bits = readTlv(bytes, octet.content, octet.end);
  if (bits.tag !== 0x03 || bits.end - bits.content < 1) throw new DerError('the key usage extension is not a bit string');
  const names: string[] = [];
  const data = bytes.subarray(bits.content + 1, bits.end);
  KEY_USAGE_BITS.forEach((name, i) => {
    const byte = data[i >> 3];
    if (byte !== undefined && (byte & (0x80 >> (i & 7))) !== 0) names.push(name);
  });
  return names;
}

function basicConstraints(bytes: Uint8Array, octet: Tlv): { ca: boolean; pathLength: number | null } {
  const seq = readTlv(bytes, octet.content, octet.end);
  if (seq.tag !== 0x30) throw new DerError('the basic constraints extension is not a sequence');
  let ca = false;
  let pathLength: number | null = null;
  for (const item of children(bytes, seq)) {
    if (item.tag === 0x01) ca = bytes[item.content] !== 0;
    else if (item.tag === 0x02) pathLength = Number.parseInt(integerHex(bytes, item), 16);
  }
  return { ca, pathLength };
}

/**
 * The certificate that starts at the beginning of `bytes`: its outline and
 * where it ends. A DER bundle is certificates one after another, so the
 * caller reads the next one from `end`.
 */
export function certificateAt(bytes: Uint8Array, offset = 0): DerCertificate {
  const cert = readTlv(bytes, offset);
  if (cert.tag !== 0x30) throw new DerError(`byte ${offset} doesn't start a certificate (a DER sequence)`);
  const [tbs] = children(bytes, cert);
  if (!tbs || tbs.tag !== 0x30) throw new DerError('the certificate has no to-be-signed part');
  const fields = children(bytes, tbs);
  // The version is optional ([0], absent in v1), and the serial follows it.
  const serialTlv = fields[fields[0]?.tag === 0xa0 ? 1 : 0];
  if (!serialTlv) throw new DerError('the certificate has no serial number');
  const serial = integerHex(bytes, serialTlv);
  const extensions = new Map<string, { critical: boolean; value: Tlv }>();
  const wrapper = fields.find((f) => f.tag === 0xa3);
  if (wrapper) {
    const [list] = children(bytes, wrapper);
    if (!list || list.tag !== 0x30) throw new DerError('the extensions are not a sequence');
    for (const ext of children(bytes, list)) {
      const parts = children(bytes, ext);
      const id = parts[0];
      const value = parts[parts.length - 1];
      if (!id || !value || value.tag !== 0x04) throw new DerError(`the extension at byte ${ext.start} is malformed`);
      const critical = parts.length === 3 && parts[1]!.tag === 0x01 && bytes[parts[1]!.content] !== 0;
      extensions.set(oidText(bytes, id), { critical, value });
    }
  }
  const ku = extensions.get(OID_KEY_USAGE);
  const bc = extensions.get(OID_BASIC_CONSTRAINTS);
  return {
    end: cert.end,
    serial,
    extensions,
    keyUsage: ku ? keyUsage(bytes, ku.value) : undefined,
    basicConstraints: bc ? basicConstraints(bytes, bc.value) : undefined,
  };
}
