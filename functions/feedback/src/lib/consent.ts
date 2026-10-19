// The feedback disclaimer: the one text every way in shows before a report is
// sent (the site's form, its curl example, and anything else that files a
// report here), and its version.
// Every report must carry `"consent": CONSENT_VERSION`, and the version is
// recorded on the queued row and in the filed issue, so each issue says which
// wording its reporter agreed to. Change the wording, bump the version.
//
// The copies elsewhere are pinned identical to this one by
// test/feedback-consent.test.ts at the repository root, so the text can't drift
// between the page that shows it and the server that holds people to it.
// It is the only terms-of-service in the building short enough to be read.

export const CONSENT_VERSION = 1;

export const DISCLAIMER = "Your report is sent to Imagile LLC to improve toil, and it becomes a public GitHub issue in imagile-dev/toil. Your email address stays private: it is used only to tell you about your issue. Before you send, remove company data: internal URLs and hostnames, ticket keys, repository and project names, people's names, other identifiers and credentials. You are responsible for what you send.";
