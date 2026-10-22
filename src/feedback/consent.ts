/**
 * The feedback disclaimer: the one text every way of sending feedback shows
 * before anything is sent (the site's form and its curl line, `toil feedback`,
 * Toil UI's Feedback dialog, and the toil skill), and the version a report
 * carries as `consent` so the function records which text was agreed to.
 * The function refuses a report without it (functions/feedback/).
 *
 * The site and the function keep their own copies, since each is its own
 * package; test/feedback-consent.test.ts holds every copy to this one. A
 * change to the text is a new version, never an edit in place: the function
 * accepts only the current one. Terms and conditions, abridged to the part
 * anyone reads.
 */

/** The version of the text below. A report sends it as `consent`. */
export const CONSENT_VERSION = 1;

export const DISCLAIMER =
  "Your report is sent to Imagile LLC to improve toil, and it becomes a public GitHub issue in imagile-dev/toil. Your email address stays private: it is used only to tell you about your issue. Before you send, remove company data: internal URLs and hostnames, ticket keys, repository and project names, people's names, other identifiers and credentials. You are responsible for what you send.";

/** Where `toil feedback` sends a report: the function's terminal endpoint (functions/feedback/, `Report`). */
export const FEEDBACK_ENDPOINT = 'https://func-toil-feedback.azurewebsites.net/api/report';

/**
 * The form on the site, for anyone whose toil can't send (a build with no
 * commit, a network that blocks the endpoint). Every link to it reads this one
 * address: `toil feedback`, Toil UI's Feedback dialog, and the toil skill and
 * Toil UI's themes doc, which test/feedback-consent.test.ts holds to it. The
 * site's link check (site/scripts/check-links.mjs) fails the build when it
 * names no page there, or only an old address that forwards (#435). A form
 * that moves leaves a forwarding address; this one doesn't rely on it.
 */
export const FEEDBACK_FORM = 'https://imagile-dev.github.io/toil/about/feedback/';
