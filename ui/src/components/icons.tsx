/**
 * Toil UI's one icon set. Every icon is a few hand-drawn strokes on one 24 unit
 * grid, drawn in `currentColor`, so a theme can recolour an icon and can do
 * nothing else to it: no theme's text font ever draws one, which is how an (i)
 * once came out as a blurred serif italic in one theme and a clean circle in
 * another. The stroke is the same on screen at every size (1.5px), so a 14px
 * icon and a 20px icon are the same weight. Icons are decoration: the button or
 * the word beside one carries the accessible name, so each is `aria-hidden`.
 *
 * To add one, put its paths in `PATHS` and export a component for it; the test
 * in `ui/test/icons.test.tsx` then holds it to the rules. Never a font glyph,
 * a letter or a unicode character standing in for an icon (a guard test
 * fails on the usual ones). Icons are not fetched, not a font and not a
 * dependency, which is the only icon licensing the security team has agreed to.
 */

import type { SVGProps } from 'react';
import './icons.css';

/** One drawn stroke. */
type Shape = { d: string };

/** Strokes on a 24 grid. A dot is a zero-length stroke, which round caps draw as a circle. */
const PATHS = {
  info: [{ d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z' }, { d: 'M12 11v5.5' }, { d: 'M12 7.5h.01' }],
  help: [{ d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z' }, { d: 'M9.4 9.6a2.7 2.7 0 1 1 3.9 2.4c-.8.4-1.3 1-1.3 1.9' }, { d: 'M12 17h.01' }],
  warning: [{ d: 'M12 3.8 21.4 20H2.6Z' }, { d: 'M12 10v4.5' }, { d: 'M12 17.2h.01' }],
  error: [{ d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z' }, { d: 'M9 9l6 6M15 9l-6 6' }],
  close: [{ d: 'M6 6l12 12M18 6 6 18' }],
  check: [{ d: 'M5 12.5l4.5 4.5L19 7.5' }],
  'chevron-down': [{ d: 'M6 9l6 6 6-6' }],
  'chevron-right': [{ d: 'M9 6l6 6-6 6' }],
  'arrow-left': [{ d: 'M19 12H5M11 6l-6 6 6 6' }],
  'arrow-up': [{ d: 'M12 19V5M6 11l6-6 6 6' }],
  'arrow-down': [{ d: 'M12 5v14M6 13l6 6 6-6' }],
  external: [{ d: 'M14 4h6v6M20 4l-9 9' }, { d: 'M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10' }],
  copy: [{ d: 'M10 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z' }, { d: 'M15.5 9V5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H9' }],
  edit: [{ d: 'M4.5 19.5l.9-4L16 5a2.1 2.1 0 0 1 3 3L8.5 18.6Z' }, { d: 'M14.5 6.5l3 3' }],
  more: [{ d: 'M5 12h.01M12 12h.01M19 12h.01' }],
  menu: [{ d: 'M4 6.5h16M4 12h16M4 17.5h16' }],
  person: [{ d: 'M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z' }, { d: 'M4.8 20c.5-3.6 3.3-5.7 7.2-5.7s6.7 2.1 7.2 5.7' }],
  agent: [{ d: 'M6 8h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z' }, { d: 'M12 8V4M9 13h.01M15 13h.01M8 21h8' }],
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'viewBox' | 'width' | 'height' | 'name'> {
  /** The icon's size in pixels. The drawing scales; the stroke stays 1.5px. */
  size?: number;
}

/** The one drawing routine: every named export below is this with a name. */
export function Icon({ name, size = 16, className, ...rest }: IconProps & { name: IconName }) {
  const shapes: readonly Shape[] = PATHS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={(1.5 * 24) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`icon icon--${name}${className ? ` ${className}` : ''}`}
      data-icon={name}
      {...rest}
    >
      {shapes.map((s, i) => (
        <path key={i} d={s.d} />
      ))}
    </svg>
  );
}

const make = (name: IconName) => (props: IconProps) => <Icon name={name} {...props} />;

export const InfoIcon = make('info');
export const HelpIcon = make('help');
export const WarningIcon = make('warning');
export const ErrorIcon = make('error');
export const CloseIcon = make('close');
export const CheckIcon = make('check');
export const ChevronDownIcon = make('chevron-down');
export const ChevronRightIcon = make('chevron-right');
export const ArrowLeftIcon = make('arrow-left');
export const ArrowUpIcon = make('arrow-up');
export const ArrowDownIcon = make('arrow-down');
export const ExternalIcon = make('external');
export const CopyIcon = make('copy');
export const EditIcon = make('edit');
export const MoreIcon = make('more');
export const MenuIcon = make('menu');

/**
 * A small person for beside a name where initials would be too much: a head and
 * shoulders, or for an AI agent a squared head with an antenna, so the two differ
 * by shape and not by colour alone. It takes the text colour and carries no meaning
 * of its own: the name beside it is the label.
 */
export function PersonGlyph({ agent = false }: { agent?: boolean }) {
  return <Icon name={agent ? 'agent' : 'person'} size={14} className={`person-glyph${agent ? ' person-glyph--agent' : ''}`} data-glyph={agent ? 'agent' : 'person'} />;
}
