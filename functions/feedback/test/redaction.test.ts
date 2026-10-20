import { beforeEach, describe, expect, it } from 'vitest';
import { readSettings } from '../src/lib/config.js';
import { processSubmissions, resetSmokeIssue, SMOKE_HEADER, SMOKE_LABEL, submit } from '../src/lib/handlers.js';
import { redactionFor } from '../src/lib/redaction.js';
import { TURNSTILE_VERIFY } from '../src/lib/turnstile.js';
import { API, ORIGIN, REPO, deps, json, memoryTables, request, type Call } from './helpers.js';

/**
 * Reports are redacted before their issue exists, with triage's own rules
 * (scripts/triage/redact.mjs), so no revision of a public issue holds what
 * triage would remove. Fictional names only: acmebank, acme-int.example.
 */

// Joined from pieces, so no whole token is written in this file.
const FAKE_TOKEN = ['ghp', '_', 'a1B2'.repeat(9)].join('');
const LEAKY = {
  kind: 'bug',
  title: 'AcmeBank: jira.acmebank.corp times out',
  body: `Ran it with TOIL_JIRA_TOKEN=${FAKE_TOKEN} against https://jira.acmebank.corp from 10.1.2.3, cc @someone`,
  email: 'you@example.com',
  consent: 1,
  turnstileToken: 'cf-token',
  website: '',
};
const site = { origin: ORIGIN, 'x-forwarded-for': '203.0.113.7:51234' };

function routes(created: Call[]) {
  let next = 100;
  return {
    [`POST ${TURNSTILE_VERIFY}`]: () => json(200, { success: true }),
    [`POST ${API}/repos/${REPO}/issues`]: (call: Call) => {
      created.push(call);
      const n = next++;
      return json(201, { number: n, html_url: `https://github.com/${REPO}/issues/${n}`, state: 'open', body: JSON.parse(call.body!).body });
    },
  };
}

/** Submits through /api/submit, runs the timer, and returns what createIssue was sent. */
async function fileThrough(settings: { redactTerms?: string }) {
  const created: Call[] = [];
  const t = deps({ routes: routes(created), settings });
  expect((await submit(request(LEAKY, site), t.deps)).status).toBe(202);
  expect((await processSubmissions(t.deps)).created).toBe(1);
  expect(created).toHaveLength(1);
  return { sent: JSON.parse(created[0]!.body!) as { title: string; body: string }, t };
}

beforeEach(() => resetSmokeIssue());

describe('redaction before the issue is created', () => {
  it('sends createIssue the redacted title and body: no token, no internal host, no private IP, no denylisted name', async () => {
    const { sent, t } = await fileThrough({ redactTerms: '# fictional\nacmebank\nacme-int.example' });
    expect(sent.title).toBe('[org]: jira.imagile.dev times out');
    expect(sent.body.split('\n\n---\n')[0]).toBe('Ran it with TOIL_JIRA_TOKEN=[redacted-secret] against https://jira.imagile.dev from [redacted-ip], cc @\u200bsomeone');
    const raw = JSON.stringify(sent);
    for (const leaked of [FAKE_TOKEN, 'acmebank', 'AcmeBank', '10.1.2.3']) expect(raw).not.toContain(leaked);
    // The queue and the submitter's own email keep their words; only the public issue is redacted.
    expect(JSON.stringify(t.mail.sent[0])).toContain('AcmeBank');
    expect(t.log.lines.filter((line) => line.startsWith('warn'))).toEqual([]);
  });

  it('still applies the built-in rules with REDACT_TERMS unset, exactly as triage does', async () => {
    const { sent } = await fileThrough({});
    expect(sent.title).toBe('AcmeBank: jira.imagile.dev times out');
    expect(sent.body).toContain('TOIL_JIRA_TOKEN=[redacted-secret] against https://jira.imagile.dev from [redacted-ip]');
    expect(sent.body).not.toContain(FAKE_TOKEN);
  });

  it('says so in the log when the Key Vault reference did not resolve, and redacts with the built-in rules', async () => {
    const { sent, t } = await fileThrough({ redactTerms: '@Microsoft.KeyVault(SecretUri=https://imagile-keyvault.vault.azure.net/secrets/FEEDBACK-REDACT-TERMS)' });
    expect(sent.body).not.toContain(FAKE_TOKEN);
    expect(t.log.lines).toContain(
      'warn Process: REDACT_TERMS is a Key Vault reference that did not resolve (is FEEDBACK-REDACT-TERMS in the vault?), so reports are redacted with the built-in rules only.',
    );
  });

  it('reads REDACT_TERMS from the app settings, one entry per line or per literal \\n, and counts refused entries', () => {
    expect(readSettings({ REDACT_TERMS: 'acmebank\nacme-int.example' }).redactTerms).toBe('acmebank\nacme-int.example');
    expect(readSettings({}).redactTerms).toBeUndefined();
    expect(redactionFor('acmebank\\nacme-int.example').terms).toMatchObject({ words: ['acmebank'], domains: ['acme-int.example'] });
    expect(redactionFor('acmebank\njira')).toMatchObject({ terms: { words: ['acmebank'], invalid: 1 }, warning: expect.stringContaining('1 REDACT_TERMS entries were refused') });
    expect(redactionFor(undefined)).toMatchObject({ terms: { words: [], domains: [], patterns: [] }, warning: undefined });
  });

  it('redacts a smoke run on the smoke-test issue too, in the form scripts/smoke.mjs waits for', async () => {
    const issues: Call[] = [];
    const t = deps({
      tables: memoryTables(),
      routes: {
        [`POST ${TURNSTILE_VERIFY}`]: () => json(200, { success: true }),
        [`GET ${API}/repos/${REPO}/issues?labels=${SMOKE_LABEL}*`]: () => json(200, [{ number: 7, body: '', state: 'closed' }]),
        [`GET ${API}/repos/${REPO}/issues/7`]: () => json(200, { number: 7, body: '', state: 'closed' }),
        [`PATCH ${API}/repos/${REPO}/issues/7`]: (call: Call) => {
          issues.push(call);
          return json(200, { number: 7 });
        },
      },
    });
    // smoke.mjs's submit title, with the private address it expects to see redacted.
    const title = 'smoke 12345-1 submit from 10.0.0.1';
    expect((await submit(request({ ...LEAKY, title }, { ...site, [SMOKE_HEADER]: 'smoke-test-key' }), t.deps)).status).toBe(202);
    await processSubmissions(t.deps);
    expect(JSON.parse(issues[0]!.body!).body).toContain('`smoke 12345-1 submit from [redacted-ip]`');
  });
});
