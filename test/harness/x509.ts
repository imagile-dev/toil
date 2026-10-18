import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

/**
 * Test-only X.509 certificates, built and signed in memory: Node can verify a
 * certificate but has no API to issue one, so this writes the DER itself.
 * Every key is generated per run and never written anywhere; nothing here is
 * a real key or a real host. Subjects are `*.imagile.dev` placeholders. A
 * certificate authority that issues in milliseconds and keeps no records is,
 * for once, exactly what the audit asked for.
 */

const tlv = (tag: number, content: Uint8Array): Buffer => {
  const len = content.length;
  const header = len < 0x80 ? [tag, len] : len < 0x100 ? [tag, 0x81, len] : len < 0x10000 ? [tag, 0x82, len >> 8, len & 0xff] : [tag, 0x83, len >> 16, (len >> 8) & 0xff, len & 0xff];
  return Buffer.concat([Buffer.from(header), content]);
};
const seq = (...items: Uint8Array[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Uint8Array[]) => tlv(0x31, Buffer.concat(items));
const explicit = (n: number, content: Uint8Array) => tlv(0xa0 + n, content);
const bool = (value: boolean) => tlv(0x01, Buffer.from([value ? 0xff : 0]));
const octets = (content: Uint8Array) => tlv(0x04, content);
const bits = (content: Uint8Array, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), content]));
const integer = (value: bigint | number) => {
  let hex = BigInt(value).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let raw = Buffer.from(hex, 'hex');
  if (raw[0]! & 0x80) raw = Buffer.concat([Buffer.from([0]), raw]);
  return tlv(0x02, raw);
};
const oid = (dotted: string) => {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const out = [a! * 40 + b!];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
};
const time = (date: Date) => {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const year = date.getUTCFullYear();
  return year >= 1950 && year < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
};

const NAME_OIDS: Record<string, string> = { CN: '2.5.4.3', O: '2.5.4.10', OU: '2.5.4.11', C: '2.5.4.6' };
/** `{ CN: 'api.imagile.dev', O: 'Imagile' }`, in that order. */
const name = (parts: Record<string, string>) =>
  seq(...Object.entries(parts).map(([key, value]) => set(seq(oid(NAME_OIDS[key]!), tlv(key === 'C' ? 0x13 : 0x0c, Buffer.from(value))))));

const KEY_USAGE = ['digitalSignature', 'nonRepudiation', 'keyEncipherment', 'dataEncipherment', 'keyAgreement', 'keyCertSign', 'cRLSign', 'encipherOnly', 'decipherOnly'];
const keyUsageBits = (names: string[]) => {
  const bytes = [0, 0];
  for (const n of names) {
    const i = KEY_USAGE.indexOf(n);
    if (i === -1) throw new Error(`x509 test helper: unknown key usage ${n}`);
    bytes[i >> 3]! |= 0x80 >> (i & 7);
  }
  const used = bytes[1] ? bytes : bytes.slice(0, 1);
  const lastByte = used[used.length - 1]!;
  let unused = 0;
  while (unused < 7 && lastByte !== 0 && (lastByte & (1 << unused)) === 0) unused++;
  return bits(Buffer.from(used), unused);
};

const EKU: Record<string, string> = { serverAuth: '1.3.6.1.5.5.7.3.1', clientAuth: '1.3.6.1.5.5.7.3.2' };

export type KeyKind = 'ec' | 'rsa' | 'ed25519';
export interface TestKey {
  kind: KeyKind;
  publicKey: KeyObject;
  privateKey: KeyObject;
}

/** A fresh test-only key pair. EC is P-256, RSA 2048 bits. */
export function testKey(kind: KeyKind = 'ec'): TestKey {
  const pair = kind === 'ec' ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' }) : kind === 'rsa' ? generateKeyPairSync('rsa', { modulusLength: 2048 }) : generateKeyPairSync('ed25519');
  return { kind, ...pair };
}

const SIG_ALG: Record<KeyKind, Buffer> = {
  ec: seq(oid('1.2.840.10045.4.3.2')),
  rsa: seq(oid('1.2.840.113549.1.1.11'), tlv(0x05, Buffer.alloc(0))),
  ed25519: seq(oid('1.3.101.112')),
};

export interface CertSpec {
  subject: Record<string, string>;
  /** The issuer's name; the subject for a self-signed certificate. */
  issuer?: Record<string, string>;
  key: TestKey;
  /** The key that signs it; its own for a self-signed certificate. */
  signer?: TestKey;
  serial?: bigint | number;
  notBefore?: Date;
  notAfter?: Date;
  /** `DNS:api.imagile.dev`, `IP:10.0.0.1`, `email:you@example.com`. */
  sans?: string[];
  ca?: boolean;
  pathLength?: number;
  keyUsage?: string[];
  extendedKeyUsage?: Array<keyof typeof EKU>;
}

export interface TestCert {
  der: Buffer;
  pem: string;
  sha256: string;
}

const DAY = 86_400_000;

/** A certificate built to `spec` and signed by `spec.signer` (or its own key). */
export function makeCert(spec: CertSpec): TestCert {
  const signer = spec.signer ?? spec.key;
  const now = Date.now();
  const extensions: Buffer[] = [];
  if (spec.sans?.length) {
    const names = spec.sans.map((s) => {
      const [type, ...rest] = s.split(':');
      const value = rest.join(':');
      if (type === 'DNS') return tlv(0x82, Buffer.from(value));
      if (type === 'email') return tlv(0x81, Buffer.from(value));
      if (type === 'IP') return tlv(0x87, Buffer.from(value.split('.').map(Number)));
      throw new Error(`x509 test helper: unknown SAN type ${type}`);
    });
    extensions.push(seq(oid('2.5.29.17'), octets(seq(...names))));
  }
  if (spec.ca !== undefined) {
    const body = spec.ca ? [bool(true), ...(spec.pathLength === undefined ? [] : [integer(spec.pathLength)])] : [];
    extensions.push(seq(oid('2.5.29.19'), bool(true), octets(seq(...body))));
  }
  if (spec.keyUsage) extensions.push(seq(oid('2.5.29.15'), bool(true), octets(keyUsageBits(spec.keyUsage))));
  if (spec.extendedKeyUsage) extensions.push(seq(oid('2.5.29.37'), octets(seq(...spec.extendedKeyUsage.map((e) => oid(EKU[e]!))))));
  const tbs = seq(
    explicit(0, integer(2)),
    integer(spec.serial ?? BigInt(`0x${createHash('sha256').update(JSON.stringify(spec.subject)).update(String(Math.random())).digest('hex').slice(0, 16)}`)),
    SIG_ALG[signer.kind],
    name(spec.issuer ?? spec.subject),
    seq(time(spec.notBefore ?? new Date(now - DAY)), time(spec.notAfter ?? new Date(now + 90 * DAY))),
    name(spec.subject),
    spec.key.publicKey.export({ type: 'spki', format: 'der' }),
    ...(extensions.length ? [explicit(3, seq(...extensions))] : []),
  );
  const signature = sign(signer.kind === 'ed25519' ? null : 'sha256', tbs, signer.privateKey);
  const der = seq(tbs, SIG_ALG[signer.kind], bits(signature));
  const pem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/.{64}/g, '$&\n').replace(/\n?$/, '\n')}-----END CERTIFICATE-----\n`;
  return { der, pem, sha256: createHash('sha256').update(der).digest('hex') };
}

export const ROOT_NAME = { C: 'US', O: 'Imagile Test', CN: 'Imagile Test Root CA' };
export const INTERMEDIATE_NAME = { C: 'US', O: 'Imagile Test', CN: 'Imagile Test Issuing CA' };
export const LEAF_NAME = { CN: 'api.imagile.dev' };

export interface TestChain {
  root: TestCert;
  intermediate: TestCert;
  leaf: TestCert;
  keys: { root: TestKey; intermediate: TestKey; leaf: TestKey };
  /** Leaf, intermediate and root, in that order, as one PEM bundle. */
  pem: string;
}

/** A three-certificate chain: an RSA root, an EC issuing CA and an EC leaf for api.imagile.dev and *.imagile.dev. */
export function makeChain(leafOverrides: Partial<CertSpec> = {}): TestChain {
  const keys = { root: testKey('rsa'), intermediate: testKey('ec'), leaf: testKey('ec') };
  const root = makeCert({ subject: ROOT_NAME, key: keys.root, ca: true, keyUsage: ['keyCertSign', 'cRLSign'], notAfter: new Date(Date.now() + 3650 * DAY) });
  const intermediate = makeCert({ subject: INTERMEDIATE_NAME, issuer: ROOT_NAME, key: keys.intermediate, signer: keys.root, ca: true, pathLength: 0, keyUsage: ['digitalSignature', 'keyCertSign', 'cRLSign'], notAfter: new Date(Date.now() + 1825 * DAY) });
  const leaf = makeCert({
    subject: LEAF_NAME,
    issuer: INTERMEDIATE_NAME,
    key: keys.leaf,
    signer: keys.intermediate,
    ca: false,
    sans: ['DNS:api.imagile.dev', 'DNS:*.imagile.dev'],
    keyUsage: ['digitalSignature'],
    extendedKeyUsage: ['serverAuth', 'clientAuth'],
    ...leafOverrides,
  });
  return { root, intermediate, leaf, keys, pem: leaf.pem + intermediate.pem + root.pem };
}
