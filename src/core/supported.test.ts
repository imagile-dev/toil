/**
 * The helper areas use when a server is older than toil supports: its text,
 * the fix that names the minimum, and the code it keeps. A version nobody has
 * established is reported as such, rather than filled in to close the ticket.
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

  it('names the minimum and the server version in the fix', () => {
    expect(tooOldFix(ado, 'REST API 6.0')).toBe(
      'toil needs Azure DevOps Server 2022.1 or later (REST API 7.1). This server reports REST API 6.0. Upgrade the server, or use a connection to one that is 2022.1 or later.',
    );
    expect(tooOldFix(unknown)).toContain('may be older than toil supports');
  });

  it('keeps the failure code, defaulting to HTTP, and carries details', () => {
    const err = serverTooOld(ado, 'The server refused api-version=7.1.', { details: { status: 400 } });
    expect(err).toMatchObject({ code: 'HTTP', message: 'The server refused api-version=7.1.', details: { status: 400 } });
    expect(err.fix).toContain('2022.1 or later');
    expect(serverTooOld(ado, 'No such endpoint.', { code: 'NOT_FOUND' }).code).toBe('NOT_FOUND');
  });
});
