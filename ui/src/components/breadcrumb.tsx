/**
 * The way back up from a page that is a step in from another (#567): "Summary › Work mix". A real breadcrumb
 * navigation, the parent a link and the page itself the current item, so a chart's full page and the earlier briefings
 * are never a dead end and the Summary stays one press away. Bread crumbs, in the original sense, are how you find your
 * way home; this one does it with fewer birds.
 */

import './breadcrumb.css';

export interface Crumb {
  label: string;
  /** Absent on the last crumb, the page itself. */
  href?: string;
}

export function Breadcrumb({ trail }: { trail: Crumb[] }) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb" data-breadcrumb="">
      <ol>
        {trail.map((c, i) => (
          <li key={`${i}:${c.label}`}>
            {c.href && i < trail.length - 1 ? (
              <a href={c.href}>{c.label}</a>
            ) : (
              <span aria-current="page">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
