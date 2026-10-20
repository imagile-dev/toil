// The token shapes: credentials recognisable by their format alone, wherever
// they appear. The one list both redactors read: src/core/secret-shapes.ts
// (the audit log and `toil util secrets scan`) and scripts/triage/redact.mjs
// (issues filed from outside, in the feedback function before the issue is
// created and again in triage). Plain JavaScript with no imports, so the
// triage scripts and the feedback function load it as it is, with no build.
//
// Every pattern starts with a literal prefix or a word boundary and repeats
// only bounded character classes, so each runs in linear time on any input.
// A redactor that hangs on a long paste has redacted the whole page, which is
// one way to meet the requirement.
//
// A shape that keeps a name in front of the secret (`sig=`, the Slack webhook
// path) puts it in a lookbehind, so a match is the secret alone.

/** @type {ReadonlyArray<{ id: string, pattern: RegExp }>} */
export const TOKEN_SHAPES = Object.freeze([
  { id: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { id: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{16,}/g },
  { id: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  // The path after the host is the credential: anyone holding it can post to the channel.
  { id: 'slack-webhook', pattern: /(?<=\bhooks\.slack\.com\/(?:services|workflows|triggers)\/)[A-Za-z0-9_/-]{16,}/g },
  { id: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'sonar-token', pattern: /\bsq[uap]_[A-Za-z0-9]{20,}/g },
  { id: 'sk-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { id: 'atlassian-token', pattern: /\bATATT[A-Za-z0-9_=-]{20,}/g },
  { id: 'bitbucket-token', pattern: /\bBBDC-[A-Za-z0-9+/_-]{20,}/g },
  { id: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{30,}/g },
  // An API key (AKCp…) or a reference token, whose base64 opens with "reftkn".
  { id: 'artifactory-token', pattern: /\b(?:AKCp[A-Za-z0-9]{20,}|cmVmdGtu[A-Za-z0-9]{20,})/g },
  // dt0c01.<public part>.<secret part>; dt0s01 and the other generations share the shape.
  { id: 'dynatrace-token', pattern: /\bdt0[a-z]\d{2}\.[A-Za-z0-9]{16,}(?:\.[A-Za-z0-9]{16,})?/g },
  { id: 'figma-token', pattern: /\bfig[du]_[A-Za-z0-9_-]{20,}/g },
  // The 52-character base32 PAT (with at least one of its digits, so a long
  // lowercase word stays) and the newer 84-character one marked AZDO.
  { id: 'azure-devops-pat', pattern: /\b(?:(?=[a-z2-7]{0,51}[2-7])[a-z2-7]{52}|[A-Za-z0-9]{76}AZDO[A-Za-z0-9]{4})\b/g },
  // A shared access signature's signature, in a URL or pasted on its own.
  { id: 'azure-sas', pattern: /(?<=\bsig=)[A-Za-z0-9%+/=_-]{16,}/g },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g },
  { id: 'private-key', pattern: /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY-----|$)/g },
]);
