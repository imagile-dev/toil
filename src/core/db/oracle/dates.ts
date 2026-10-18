import { BaseBuffer } from 'oracledb/lib/impl/datahandlers/buffer.js';

/**
 * Oracle dates and timestamps as the text the server holds, read from the
 * wire bytes rather than from the Date the driver builds.
 *
 * Thin mode decodes a DATE or TIMESTAMP into a JavaScript Date in the local
 * time zone of whoever runs toil, dropping everything past the millisecond.
 * That changes values: a time in the local daylight-saving gap moves an hour,
 * and a TIMESTAMP(9) loses six digits. Asking for a string doesn't help,
 * because Thin mode makes that string from the same Date on the client; the
 * session's NLS formats never apply. So toil keeps the driver's own decoder
 * (the Date it returns is unchanged, for anything in the driver that uses
 * it) and records, beside each Date, the text of the bytes it came from.
 * The fetch type handler hands back that text. Nothing goes through the
 * local time zone.
 *
 * The text matches what PostgreSQL and MySQL return: `2026-01-02 03:04:05`,
 * a fraction only when there is one, with its trailing zeros trimmed, and a
 * zoned value's offset (`+02`, `+05:30`) as PostgreSQL writes it.
 *
 * A timestamp stored without a zone is not to be routed through one on its
 * way out; it holds no travel authorization for the local time zone.
 */

const exact = new WeakMap<Date, string>();

/** The text recorded for a Date the driver decoded, if any. */
export function exactText(value: Date): string | undefined {
  return exact.get(value);
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0');

function wallClock(year: number, month: number, day: number, hour: number, minute: number, second: number, nanos: number): string {
  const y = `${year < 0 ? '-' : ''}${pad(year, 4)}`;
  const fraction = nanos > 0 ? `.${pad(nanos, 9).replace(/0+$/, '')}` : '';
  return `${y}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}${fraction}`;
}

/**
 * The wire form: century + 100, year + 100, month, day, hour + 1, minute + 1,
 * second + 1; then, for a TIMESTAMP, nanoseconds as a 32-bit integer; then,
 * for a TIMESTAMP WITH TIME ZONE, the zone's hour + 20 and minute + 60, or a
 * region id when the first of those has its top bit set. A zoned value's
 * fields are in UTC.
 */
export function oracleDateText(buf: Uint8Array, zoned: boolean): string {
  const view = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const year = (view[0]! - 100) * 100 + view[1]! - 100;
  const fields = [year, view[2]!, view[3]!, view[4]! - 1, view[5]! - 1, view[6]! - 1] as const;
  const nanos = view.length >= 11 ? view.readUInt32BE(7) : 0;
  if (!zoned) return wallClock(...fields, nanos);
  // A named region (Europe/Paris) needs Oracle's region table to turn into an
  // offset, so it reads as the same instant in UTC.
  const named = view.length < 13 || (view[11]! & 0x80) !== 0;
  const offsetMinutes = named ? 0 : (view[11]! - 20) * 60 + (view[12]! - 60);
  const utc = new Date(0);
  utc.setUTCFullYear(fields[0], fields[1] - 1, fields[2]);
  utc.setUTCHours(fields[3], fields[4] + offsetMinutes, fields[5], 0);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const zone = `${sign}${pad(Math.trunc(offsetMinutes / 60))}${offsetMinutes % 60 ? `:${pad(offsetMinutes % 60)}` : ''}`;
  return wallClock(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds(), nanos) + zone;
}

/**
 * Wraps the driver's date reader once, on load. `useLocalTime` is false for
 * the zoned types, which is how the driver itself tells them apart.
 */
const proto = BaseBuffer.prototype;
if (!(proto.readOracleDate as { toilExact?: boolean }).toilExact) {
  const readOracleDate = function (this: InstanceType<typeof BaseBuffer>, useLocalTime: boolean): Date | null {
    const buf = this.readBytesWithLength();
    if (!buf) return null;
    const date = this.parseOracleDate(buf, useLocalTime);
    if (date instanceof Date) exact.set(date, oracleDateText(buf, !useLocalTime));
    return date;
  };
  Object.assign(readOracleDate, { toilExact: true });
  proto.readOracleDate = readOracleDate;
}
