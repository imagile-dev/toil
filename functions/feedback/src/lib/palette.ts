// The emails' colours: Toil UI Plain's, the site's palette since #442, copied
// from ui/themes/plain/theme.json. Email clients drop variables and most
// stylesheets, so the templates write these as inline hex, and this package
// can't read the theme at run time (it deploys on its own). The root suite's
// test/brand-sync.test.ts fails when any value here differs from the theme,
// so a recolour there is a one-line change here, caught before it ships.
//
// No imports, on purpose: the root suite loads this file without installing
// this package's dependencies. A palette that needs a cloud SDK to be looked
// at would be a procurement request.

/** The Plain roles the emails use, named as theme.json names them. */
export type EmailRole = 'bg' | 'surface' | 'ink' | 'muted' | 'line' | 'accent' | 'link' | 'ok';

/**
 * Light is what every client shows first; dark is applied by clients that
 * honour `prefers-color-scheme` (templates.ts). Each value is Plain's own for
 * that scheme.
 */
export const EMAIL_COLORS: Record<'light' | 'dark', Record<EmailRole, string>> = {
  light: {
    bg: '#ffffff',
    surface: '#f5f6f8',
    ink: '#1b1f24',
    muted: '#4f5863',
    line: '#c9d0d8',
    accent: '#0b5cad',
    link: '#0b5cad',
    ok: '#116329',
  },
  dark: {
    bg: '#0f1115',
    surface: '#171a21',
    ink: '#e8eaed',
    muted: '#a7afba',
    line: '#3a414d',
    accent: '#8cc4ff',
    link: '#8cc4ff',
    ok: '#6fd394',
  },
};
