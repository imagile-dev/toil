/**
 * The helper areas use when a server is older than toil supports: its text,
 * the message that says so plainly, the fix that names the minimum, and the
 * code it keeps. A version nobody has established is reported as such, rather
 * than filled in to close the ticket.
 */
import { describe, expect, it } from 'vitest';
import { serverTooOld, supportedText, tooOldFix, type SupportedVersion } from './supported.js';

const ado: SupportedVersion = { product: 'Azure DevOps Server', minimum: '2022.1', api: 'REST API 7.1' };
const unknown: SupportedVersion = { product: 'Jira Data Center', minimum: null };

describe('supported versions', () => {
  it('states the minimum with its API version, or says it is not established', () => {
    expect(supportedText(ado)).toBe('Azure DevOps Server 2022.1 or later (REST API 7.1)');
    expect(supportedText({ product: 'SonarQube', minimum: '9.9' })).toBe('SonarQube 9.9 or later');
    expect(supportedText(unknown)).toBe("The oldest Jira Data Center version toil supports hasn't been established");
  });

  it('says plainly that the server is too old, names the minimum, and adds what the server reported', () => {
    const err = serverTooOld(ado, { found: 'REST API 6.0', detail: 'The requested REST API version of 7.1 is out of range.', details: { status: 400 } });
    expect(err.message).toBe(
      'This server is too old for toil, which needs Azure DevOps Server 2022.1 or later (REST API 7.1). It reports REST API 6.0. The server said: The requested REST API version of 7.1 is out of range.',
    );
    expect(err.fix).toBe('Upgrade the server to Azure DevOps Server 2022.1 or later, or use a connection to one that is.');
    expect(err).toMatchObject({ code: 'HTTP', details: { status: 400 } });
  });

  it('keeps the failure code it is given', () => {
    expect(serverTooOld(ado, { code: 'NOT_FOUND' }).code).toBe('NOT_FOUND');
  });

  it('when no minimum is established, says the server may be too old rather than inventing one', () => {
    expect(serverTooOld(unknown).message).toBe("This server may be too old for toil; the oldest Jira Data Center version toil supports hasn't been established.");
    expect(tooOldFix(unknown)).toContain('Check the Jira Data Center version');
  });
});
