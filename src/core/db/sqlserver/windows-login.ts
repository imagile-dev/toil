import { once } from 'node:events';
import { Connection } from 'tedious';
import * as login7Module from 'tedious/lib/login7-payload.js';
import { Login7TokenHandler } from 'tedious/lib/token/handler.js';
import { NotEnoughDataError } from 'tedious/lib/token/helpers.js';
import StreamParser from 'tedious/lib/token/stream-parser.js';
import { SSPIToken } from 'tedious/lib/token/token.js';
import type { SspiExchange } from '../../../os/windows-sspi.js';

/**
 * Teaches tedious a Windows sign-in whose tokens come from Windows. tedious
 * already speaks TDS's SSPI exchange for its own NTLM mode: an SSPI blob in
 * the login packet, then one SSPI message (packet type 0x11) per token the
 * server sends back. What it lacks is a way to get those tokens from
 * anywhere but its own NTLM code. So a connection toil marks with an
 * exchange is configured as `ntlm`, and two of tedious's methods are
 * wrapped, once, for marked connections only:
 *
 * - `sendLogin7Packet`: the login packet carries the exchange's first token
 *   in place of tedious's NTLM negotiate message.
 * - `performSentLogin7WithNTLMLogin`: each SSPI token from the server goes to
 *   the exchange, and its answer goes back as the SSPI message. tedious's own
 *   loop computes an NTLM response there, synchronously, which Windows can't.
 *
 * Every other connection takes tedious's own path untouched. The methods
 * are private to tedious, so `test/db/sqlserver-windows.test.ts` checks
 * they're still there: a tedious upgrade that renames one fails a test, not
 * a login. Amending another department's form is permitted, provided the
 * original stays legible underneath.
 */

const EXCHANGE = Symbol.for('toil.sqlserver.sspi');
/** TDS packet type for an SSPI message after the login packet. */
const SSPI_MESSAGE = 0x11;
/** TDS token type of an SSPI token from the server. */
const SSPI_TOKEN = 0xed;

interface InternalConnection {
  [EXCHANGE]?: SspiExchange;
  ntlmpacket?: unknown;
  ntlmpacketBuffer?: Buffer;
  messageIo: { readMessage(): Promise<AsyncIterable<Buffer>>; sendMessage(type: number, data: Buffer): void };
  createTokenStreamParser(message: unknown, handler: unknown): NodeJS.EventEmitter;
  wrapSocketError(err: unknown): unknown;
  sendLogin7Packet(): void;
  performSentLogin7WithNTLMLogin(signal: AbortSignal): Promise<unknown>;
}

type Login7Class = { prototype: { toBuffer(this: { sspi?: Buffer }): Buffer } };
// A CommonJS default export: Node's loader wraps it once more than esbuild's does.
const Login7Payload = ((login7Module as unknown as { default: Login7Class & { default?: Login7Class } }).default.default ??
  (login7Module as unknown as { default: Login7Class }).default) as Login7Class;

const proto = Connection.prototype as unknown as InternalConnection & Record<symbol, unknown>;
const PATCHED = Symbol.for('toil.sqlserver.sspi.patched');

type ParserProto = { buffer: Buffer; position: number; parseToken(parser: unknown): unknown };
const parserProto = (StreamParser as unknown as { prototype: ParserProto }).prototype;

/** True when the tedious methods this wraps still exist. */
export function tediousSupportsSspi(): boolean {
  return (
    typeof proto.sendLogin7Packet === 'function' &&
    typeof proto.performSentLogin7WithNTLMLogin === 'function' &&
    typeof Login7Payload?.prototype?.toBuffer === 'function' &&
    typeof parserProto?.parseToken === 'function'
  );
}

/**
 * tedious reads every SSPI token from the server as an NTLM CHALLENGE, at
 * fixed offsets up to byte 48, and a shorter Negotiate (SPNEGO or Kerberos)
 * token makes those reads throw a RangeError before any handler sees it.
 * When that happens, this reads the token's length and bytes itself and
 * hands them on unparsed, which is all the helper needs. A real NTLM
 * challenge never gets here, so tedious's own NTLM path is unchanged.
 */
export function readSspiTokenRaw(parser: ParserProto): SSPIToken {
  const at = parser.position + 1;
  if (parser.buffer.length < at + 2) throw new NotEnoughDataError(at + 2);
  const length = parser.buffer.readUInt16LE(at);
  if (parser.buffer.length < at + 2 + length) throw new NotEnoughDataError(at + 2 + length);
  const data = Buffer.from(parser.buffer.subarray(at + 2, at + 2 + length));
  parser.position = at + 2 + length;
  // Login7TokenHandler only looks for a truthy ntlmpacket before keeping the raw bytes.
  return new SSPIToken({} as never, data);
}

/** The first token for the login packet being built right now, if its connection is marked. Set only for the length of one synchronous call. */
let loginToken: Buffer | undefined;

if (!proto[PATCHED] && tediousSupportsSspi()) {
  proto[PATCHED] = true;

  const toBuffer = Login7Payload.prototype.toBuffer;
  Login7Payload.prototype.toBuffer = function (this: { sspi?: Buffer }) {
    if (loginToken) this.sspi = loginToken;
    return toBuffer.call(this);
  };

  const parseToken = parserProto.parseToken;
  parserProto.parseToken = function (this: ParserProto, parser: unknown) {
    try {
      return parseToken.call(this, parser);
    } catch (err) {
      if (err instanceof RangeError && this.buffer[this.position] === SSPI_TOKEN) return readSspiTokenRaw(this);
      throw err;
    }
  };

  const sendLogin7Packet = proto.sendLogin7Packet;
  proto.sendLogin7Packet = function (this: InternalConnection) {
    const exchange = this[EXCHANGE];
    if (!exchange) return sendLogin7Packet.call(this);
    loginToken = exchange.first;
    try {
      return sendLogin7Packet.call(this);
    } finally {
      loginToken = undefined;
    }
  };

  const ntlmLogin = proto.performSentLogin7WithNTLMLogin;
  proto.performSentLogin7WithNTLMLogin = async function (this: InternalConnection, signal: AbortSignal) {
    const exchange = this[EXCHANGE];
    if (!exchange) return ntlmLogin.call(this, signal);
    signal.throwIfAborted();
    const aborted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    aborted.catch(() => {});
    while (true) {
      const message = await Promise.race([this.messageIo.readMessage().catch((err) => Promise.reject(this.wrapSocketError(err))), aborted]);
      const handler = new Login7TokenHandler(this as unknown as Connection) as Login7TokenHandler & { loginAckReceived?: boolean; loginError?: unknown; routingData?: unknown };
      const ended = once(this.createTokenStreamParser(message, handler), 'end');
      ended.catch(() => {});
      await Promise.race([ended, aborted]);
      if (handler.loginAckReceived) return handler.routingData;
      if (this.ntlmpacketBuffer) {
        const serverToken = this.ntlmpacketBuffer;
        this.ntlmpacket = undefined;
        this.ntlmpacketBuffer = undefined;
        this.messageIo.sendMessage(SSPI_MESSAGE, await Promise.race([exchange.next(serverToken), aborted]));
      } else if (handler.loginError) {
        throw handler.loginError;
      } else {
        throw Object.assign(new Error('Login failed.'), { code: 'ELOGIN' });
      }
    }
  };
}

/** Marks a connection, configured as `ntlm`, to sign in with this exchange's tokens. */
export function useExchange(connection: Connection, exchange: SspiExchange): void {
  (connection as unknown as InternalConnection)[EXCHANGE] = exchange;
}
