// The two emails a submitter gets: one when their issue is filed, one when it
// closes. Plain text first, HTML alongside, with every inserted value escaped.
// The tone is the site's, not the code comments': straight and friendly. The
// jokes stay up here, where the recipient will never be asked to read them.

import type { Message } from './email.js';

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** One line, no control characters, so a title can't add mail headers or break the layout. */
const oneLine = (value: string, max: number): string => {
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const wrap = (body: string): string =>
  `<!doctype html><html><body style="margin:0;padding:24px;background:#16130f;color:#f6f1e9;font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5">` +
  `<div style="max-width:560px;margin:0 auto">${body}` +
  `<p style="margin-top:32px;color:#b4a998;font-size:13px">You're getting this because this address was given with a report to toil. ` +
  `It's used for this and the closing notice only, and never shown on GitHub.</p></div></body></html>`;

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
      `<p>Thanks for writing in. Your report <strong>${escapeHtml(t)}</strong> is now ` +
        `<a style="color:#ffb84d" href="${escapeHtml(issue.url)}">issue #${issue.number}</a>.</p>` +
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
  const comment = lastComment?.trim() ? lastComment.trim().slice(0, 2000) : undefined;
  return {
    to,
    subject: `toil #${issue.number} is closed`,
    text:
      `Your report "${t}" (issue #${issue.number}) is closed. ${reason}\n${issue.url}\n` +
      (comment ? `\nThe last comment from the maintainers:\n\n${comment}\n` : '') +
      `\nThis is the last email about it.`,
    html: wrap(
      `<p>Your report <strong>${escapeHtml(t)}</strong> ` +
        `(<a style="color:#ffb84d" href="${escapeHtml(issue.url)}">issue #${issue.number}</a>) is closed. ${escapeHtml(reason)}</p>` +
        (comment
          ? `<p>The last comment from the maintainers:</p><blockquote style="margin:0;padding:8px 16px;border-left:3px solid #ffb84d;white-space:pre-wrap">${escapeHtml(comment)}</blockquote>`
          : '') +
        `<p>This is the last email about it.</p>`,
    ),
  };
}
