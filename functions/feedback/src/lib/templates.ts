// The two emails a submitter gets: one when their issue is filed, one when it
// closes. Plain text first, HTML alongside, with every inserted value escaped.
// The tone is the site's, not the code comments': straight and friendly. The
// jokes stay up here, where the recipient will never be asked to read them.
//
// The colours are Toil UI Plain's (palette.ts), inline because most clients
// drop stylesheets. The light scheme is inline, so every client gets a
// readable message; clients that honour prefers-color-scheme also get Plain's
// dark scheme from the one <style> block, which overrides the inline values by
// class. Clients that recolour on their own start from the light scheme, the
// one they're built to invert.

import type { Message } from './email.js';
import { EMAIL_COLORS, type EmailRole } from './palette.js';

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** One line, no control characters, so a title can't add mail headers or break the layout. */
const oneLine = (value: string, max: number): string => {
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

type Scheme = Record<EmailRole, string>;

/**
 * Each class the HTML uses, and the colours it takes in a scheme. The light
 * scheme is written inline; the dark one goes in the media query.
 */
const STYLES = {
  page: (c: Scheme) => `background:${c.bg};color:${c.ink}`,
  brand: (c: Scheme) => `color:${c.accent};border-bottom:1px solid ${c.line}`,
  link: (c: Scheme) => `color:${c.link}`,
  quote: (c: Scheme) => `background:${c.surface};border-left:3px solid ${c.accent};color:${c.ink}`,
  ok: (c: Scheme) => `color:${c.ok}`,
  muted: (c: Scheme) => `color:${c.muted}`,
} satisfies Record<string, (c: Scheme) => string>;
type Style = keyof typeof STYLES;

/** A class with its light colours inline, after any layout that doesn't change with the scheme. */
const style = (name: Style, layout = ''): string => `class="t-${name}" style="${layout}${STYLES[name](EMAIL_COLORS.light)}"`;

const darkCss = (Object.keys(STYLES) as Style[])
  .map((name) => `.t-${name}{${STYLES[name](EMAIL_COLORS.dark).replace(/;/g, '!important;')}!important}`)
  .join('');

const head =
  `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">` +
  `<style>:root{color-scheme:light dark;supported-color-schemes:light dark}` +
  `@media (prefers-color-scheme:dark){${darkCss}}</style></head>`;

const wrap = (body: string): string =>
  `<!doctype html><html lang="en">${head}<body ${style('page', 'margin:0;padding:0;')}>` +
  `<div ${style('page', 'padding:24px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;')}>` +
  `<div style="max-width:560px;margin:0 auto">` +
  `<p ${style('brand', 'margin:0 0 24px;padding-bottom:12px;font-size:20px;font-weight:700;')}>toil</p>` +
  body +
  `<p ${style('muted', 'margin-top:32px;font-size:14px;')}>You're getting this because this address was given with a report to toil. ` +
  `It's used for this and the closing notice only, and never shown on GitHub.</p></div></div></body></html>`;

const issueLink = (issue: { number: number; url: string }): string =>
  `<a ${style('link', 'text-decoration:underline;')} href="${escapeHtml(issue.url)}">issue #${issue.number}</a>`;

export function confirmation(to: string, issue: { number: number; url: string }, title: string): Message {
  const t = oneLine(title, 120);
  return {
    to,
    subject: `toil #${issue.number}: we got your report`,
    text:
      `Thanks for writing in. Your report "${t}" is now issue #${issue.number}:\n${issue.url}\n\n` +
      `You'll get one more email when it closes, with the reason and the last word from the maintainers.\n\n` +
      `This address is used for that and nothing else, and it isn't shown on GitHub.`,
    html: wrap(
      `<p>Thanks for writing in. Your report <strong>${escapeHtml(t)}</strong> is now ${issueLink(issue)}.</p>` +
        `<p>You'll get one more email when it closes, with the reason and the last word from the maintainers.</p>`,
    ),
  };
}

const REASONS: Record<string, string> = {
  completed: 'It was closed as done.',
  not_planned: "It was closed as not planned, so it won't be worked on.",
  duplicate: 'It was closed as a duplicate of another issue.',
};

export function closed(to: string, issue: { number: number; url: string; stateReason: string | null }, title: string, lastComment: string | undefined): Message {
  const t = oneLine(title, 120);
  const reason = REASONS[issue.stateReason ?? ''] ?? 'It was closed.';
  // Done is the one outcome in Plain's green; the words say it too, so the colour is never the only signal.
  const reasonHtml = issue.stateReason === 'completed' ? `<span ${style('ok', 'font-weight:600;')}>${escapeHtml(reason)}</span>` : escapeHtml(reason);
  const comment = lastComment?.trim() ? lastComment.trim().slice(0, 2000) : undefined;
  return {
    to,
    subject: `toil #${issue.number} is closed`,
    text:
      `Your report "${t}" (issue #${issue.number}) is closed. ${reason}\n${issue.url}\n` +
      (comment ? `\nThe last comment from the maintainers:\n\n${comment}\n` : '') +
      `\nThis is the last email about it.`,
    html: wrap(
      `<p>Your report <strong>${escapeHtml(t)}</strong> (${issueLink(issue)}) is closed. ${reasonHtml}</p>` +
        (comment
          ? `<p>The last comment from the maintainers:</p><blockquote ${style('quote', 'margin:0;padding:8px 16px;white-space:pre-wrap;')}>${escapeHtml(comment)}</blockquote>`
          : '') +
        `<p>This is the last email about it.</p>`,
    ),
  };
}
