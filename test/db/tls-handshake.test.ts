import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { TLSSocket } from 'node:tls';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { clientConfig } from '../../src/core/db/postgres/index.js';
import type { DbConnection } from '../../src/core/db/provider.js';
import type { NetworkApis } from '../../src/core/network.js';

/**
 * A real TLS handshake, on loopback, through the PostgreSQL client config
 * toil builds. The server presents a certificate whose only name is
 * db.imagile.dev, signed by a throwaway CA (test/fixtures/tls, test only), and
 * the client connects to 127.0.0.1: it is accepted only when told to verify
 * db.imagile.dev and to trust that CA, and refused for any other name or with
 * no CA. MySQL got the same runs against a real mysql:8.4 container (the PR
 * shows them); its handshake needs a server that speaks MySQL's, which isn't
 * worth faking here.
 */

const fixtures = join(import.meta.dirname, '..', 'fixtures', 'tls');
const CA_FILE = join(fixtures, 'ca.pem');
const key = readFileSync(join(fixtures, 'server.key'));
const cert = readFileSync(join(fixtures, 'server.pem'));

// No OS store, no Node defaults: the CA file is the only thing this connection could trust.
const nothingElse: NetworkApis = {
  getCACertificates: (() => []) as unknown as NetworkApis['getCACertificates'],
  setDefaultCACertificates: () => {},
  setGlobalProxyFromEnv: () => () => {},
};

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

/** A PostgreSQL stand-in that answers the SSL request and then does a TLS server handshake, noting the SNI it was sent. */
function listen(): Promise<{ port: number; seen: string[] }> {
  const seen: string[] = [];
  return new Promise((resolve) => {
    server = createServer((socket) => {
      socket.on('error', () => {});
      socket.once('data', () => {
        socket.write('S');
        const secure = new TLSSocket(socket, {
          isServer: true,
          key,
          cert,
          SNICallback: (name, done) => {
            seen.push(`sni=${name}`);
            done(null, undefined as never);
          },
        });
        secure.on('secure', () => {
          seen.push('secure');
          secure.destroy();
        });
        secure.on('error', () => {});
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: (server!.address() as { port: number }).port, seen }));
  });
}

async function connect(port: number, settings: object): Promise<string | undefined> {
  const conn = { name: 'x', area: 'db', engine: 'postgres', host: '127.0.0.1', port, database: 'd', user: 'u', password: 'p', ssl: true, ...settings } as unknown as DbConnection;
  const client = new pg.Client(clientConfig(conn, () => {}, nothingElse));
  client.on('error', () => {});
  try {
    await client.connect();
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code ?? (err as Error).message;
  } finally {
    await new Promise((done) => setTimeout(done, 50));
  }
}

describe('PostgreSQL TLS handshake with tlsServerName and tlsCaFile', () => {
  it('verifies the certificate against the TLS name, sends it as SNI, and reaches the real host', async () => {
    const { port, seen } = await listen();
    // The server hangs up after the handshake, so the client's error is the close, never a certificate error.
    const outcome = await connect(port, { tlsServerName: 'db.imagile.dev', tlsCaFile: CA_FILE });
    expect(seen).toEqual(['sni=db.imagile.dev', 'secure']);
    expect(outcome).not.toMatch(/CERT|UNABLE_TO|SELF_SIGNED/);
  });

  it('refuses a name the certificate does not carry, even with the CA trusted', async () => {
    const { port } = await listen();
    expect(await connect(port, { tlsServerName: 'other.imagile.dev', tlsCaFile: CA_FILE })).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
  });

  it('refuses the real host name when it is not on the certificate', async () => {
    const { port } = await listen();
    expect(await connect(port, { tlsCaFile: CA_FILE })).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
  });

  it('refuses the right name when the CA is not trusted', async () => {
    const { port } = await listen();
    expect(await connect(port, { tlsServerName: 'db.imagile.dev' })).toMatch(/UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT/);
  });
});
