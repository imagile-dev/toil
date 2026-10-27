/**
 * The clock arithmetic the briefing and Toil UI share. Time waiting on a
 * review is counted in working days, Monday to Friday UTC, since nobody
 * reviews at the weekend except the people who say they don't. Moved here
 * from Toil UI (#494) so toil's briefing and Toil UI's pull request page
 * count the same days.
 */

export const DAY = 86_400_000;

/** Working days between two instants, Monday to Friday UTC, to the fraction of a day. */
export function workingDays(from: string, to: string): number {
  let a = Date.parse(from);
  const b = Date.parse(to);
  if (!(b > a)) return 0;
  let n = 0;
  while (a < b) {
    const end = Math.min(b, (Math.floor(a / DAY) + 1) * DAY);
    const d = new Date(a).getUTCDay();
    if (d !== 0 && d !== 6) n += (end - a) / DAY;
    a = end;
  }
  return n;
}

/** Calendar days between two instants, to the fraction of a day; 0 when `to` isn't later. */
export const calendarDays = (from: string, to: string) => Math.max(0, (Date.parse(to) - Date.parse(from)) / DAY);

/** One decimal place, for figures said in words. */
export const round1 = (n: number) => Math.round(n * 10) / 10;
