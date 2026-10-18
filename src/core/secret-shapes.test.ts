import { describe, expect, it } from 'vitest';
import { findSecrets, redactText, SECRET_RULES, TOKEN_SHAPES } from './secret-shapes.js';

/** One planted secret per rule, with the exact characters findSecrets must point at. */
const PLANTED: Array<{ rule: string; text: string; secret: string }> = [
  { rule: 'github-token', text: `push with ghp_${'a1B2'.repeat(9)} now`, secret: `ghp_${'a1B2'.repeat(9)}` },
  { rule: 'gitlab-token', text: `CI=glpat-${'x1Y2'.repeat(5)}`, secret: `glpat-${'x1Y2'.repeat(5)}` },
  { rule: 'slack-token', text: 'hook xoxb-1234567890-abc', secret: 'xoxb-1234567890-abc' },
  { rule: 'aws-access-key', text: 'id AKIAABCDEFGHIJKLMNOP', secret: 'AKIAABCDEFGHIJKLMNOP' },
  { rule: 'sonar-token', text: `sqp_${'a1'.repeat(12)}`, secret: `sqp_${'a1'.repeat(12)}` },
  { rule: 'sk-key', text: `key sk-${'Ab3'.repeat(8)}`, secret: `sk-${'Ab3'.repeat(8)}` },
  { rule: 'atlassian-token', text: `ATATT${'Zz9'.repeat(8)}`, secret: `ATATT${'Zz9'.repeat(8)}` },
  { rule: 'jwt', text: 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMxMjM0NSJ9.c2lnbmF0dXJl end', secret: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMxMjM0NSJ9.c2lnbmF0dXJl' },
  { rule: 'private-key', text: 'k -----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBg\n-----END PRIVATE KEY----- k', secret: '-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBg\n-----END PRIVATE KEY-----' },
  { rule: 'url-credentials', text: 'see https://bob:hunter2@jira.imagile.dev/rest', secret: 'bob:hunter2' },
  { rule: 'url-credentials', text: 'see https://jira.imagile.dev/rest?os_password=pw42&projectKey=PROJ', secret: 'pw42' },
  { rule: 'authorization-value', text: 'curl -H "Bearer abcdefgh12345"', secret: 'abcdefgh12345' },
  { rule: 'name-value', text: 'Password=hunter2; (conn string)', secret: 'hunter2' },
  { rule: 'name-value', text: '{"apiToken": "abc"}', secret: 'abc' },
  { rule: 'name-value', text: 'Authorization: Bearer abc', secret: 'abc' },
  { rule: 'name-value', text: 'mysql -p=hunter2 -h db', secret: 'hunter2' },
  { rule: 'user-flag', text: 'curl -u admin:hunter2 x', secret: 'hunter2' },
  { rule: 'long-random', text: 'r Zq8xLm2Np4Rt6Vw9Yb1Cd3Ef5Gh7Jk0M r', secret: 'Zq8xLm2Np4Rt6Vw9Yb1Cd3Ef5Gh7Jk0M' },
];

describe('secret shapes', () => {
  it('names every rule it can report', () => {
    expect(new Set(PLANTED.map((p) => p.rule))).toEqual(new Set(SECRET_RULES));
    expect(SECRET_RULES.slice(0, TOKEN_SHAPES.length)).toEqual(TOKEN_SHAPES.map((s) => s.id));
  });

  it('finds each planted secret at its exact position, the secret alone and never the name or scheme around it', () => {
    for (const { rule, text, secret } of PLANTED) {
      const matches = findSecrets(text);
      const hit = matches.find((m) => text.slice(m.index, m.index + m.length) === secret);
      expect(hit, `${rule} in ${JSON.stringify(text)}: ${JSON.stringify(matches)}`).toBeDefined();
      expect(hit!.rule, text).toBe(rule);
    }
  });

  it('agrees with redactText about whether a string holds a secret, because both read the same rules', () => {
    const kept = ['PROJ-123', 'a'.repeat(20) + '0123456789abcdef0123', 'abc12345-0000-0000-0000-000000000000', '/rest/api/2/project/ABC1/components', 'status = Done AND project = PAY', 'project.key=PAY author.name=alice', 'https://jira.imagile.dev/rest?projectKey=PROJ', 'Authorization: Bearer [redacted]', 'token=[redacted]'];
    for (const text of [...PLANTED.map((p) => p.text), ...kept]) {
      expect(findSecrets(text).length > 0, text).toBe(redactText(text) !== text);
    }
  });

  it('covers the whole secret: blanking every match leaves none of it behind', () => {
    for (const { text, secret } of PLANTED) {
      let masked = text;
      for (const m of findSecrets(text)) masked = `${masked.slice(0, m.index)}${'*'.repeat(m.length)}${masked.slice(m.index + m.length)}`;
      expect(masked, text).not.toContain(secret);
      for (let i = 0; i + 4 <= secret.length; i++) if (!/[s-]/.test(secret.slice(i, i + 4))) expect(masked, text).not.toContain(secret.slice(i, i + 4));
    }
  });

  it('drops a match lying inside another and sorts by position', () => {
    const token = `ghp_${'a1B2'.repeat(9)}`;
    const text = `password=${token} and AKIAABCDEFGHIJKLMNOP`;
    expect(findSecrets(text)).toEqual([
      { rule: 'github-token', index: 9, length: token.length },
      { rule: 'aws-access-key', index: text.indexOf('AKIA'), length: 20 },
    ]);
  });

  it('stays fast on a large text holding many secrets', () => {
    const text = `token=abc12345 AKIAABCDEFGHIJKLMNOP plain words `.repeat(20_000);
    const started = performance.now();
    expect(findSecrets(text)).toHaveLength(40_000);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
