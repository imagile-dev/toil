/**
 * The one dash for a figure nobody has read (principle 12, "Unknown is not
 * zero"): "–" on screen, "not read yet" to a screen reader, never 0. Lifted
 * out of the toil project head's Trend and Count so the chart kit, the head and
 * every card say it the same way.
 *
 * - `<Unread />` is the dash and its words, for inline use.
 * - `<Figure value={n | null} />` is a number, or `<Unread />` when it is null.
 *
 * Its class names are the ones the head's stylesheet already styles
 * (`count__value`, `trend__total`), so what the head renders is unchanged.
 * Filed in triplicate, under "Figures, absence of": zero copies.
 */

import type { ReactNode } from 'react';

export const NOT_READ = 'not read yet';

/**
 * A dash for the eye and "not read yet" to a screen reader, as one element with an aria-label, the idiom the setup
 * screens already use. `label` says more where the dash stands alone ("Pull requests merged: not read yet").
 */
export function Unread({ className, label = NOT_READ, titled = false }: { className?: string; label?: string; /** Also a hover title, for a table cell where nothing else says what the dash is. */ titled?: boolean }) {
  return (
    <span {...(className ? { className } : {})} aria-label={label} {...(titled ? { title: label } : {})}>
      –
    </span>
  );
}

/** A number, or the dash for one nobody read. `format` shapes a number (a unit, a rounding); it is never given null. */
export function Figure({ value, format = String, className }: { value: number | null; format?: (n: number) => ReactNode; className?: string }) {
  return value === null ? <Unread {...(className ? { className } : {})} /> : <span className={className}>{format(value)}</span>;
}
