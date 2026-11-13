import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../owi/types.js';
import { readCategoryField } from './existing.js';
import { detectSignal } from './signals.js';

function item(key: string, extra: Partial<WorkItem> = {}, area = 'jira'): WorkItem {
  return {
    owi: '0.2',
    id: `conn:${key}`,
    source: { area, connection: 'conn', key, command: `${area} issue search` },
    url: null,
    type: 'TASK',
    typeName: 'Task',
    title: 'Plain work',
    body: null,
    labels: [],
    reporter: null,
    links: [],
    parent: null,
    native: {},
    ...extra,
  } as WorkItem;
}
const hit = (i: WorkItem, others: WorkItem[] = []) => detectSignal(i, new Map([i, ...others].map((x) => [x.id, x])));

describe('signals', () => {
  it('type: a bug or an incident, by its own type name', () => {
    expect(hit(item('A-1', { type: 'BUG', typeName: 'Bug' }))).toEqual({ name: 'type', reason: 'Its type is Bug.' });
    expect(hit(item('A-1', { type: 'INCIDENT', typeName: null }))?.name).toBe('type');
    expect(hit(item('A-1', { type: 'STORY', typeName: 'Story' }))).toBeNull();
  });

  it('security-id: a CVE or GHSA id in the title or body', () => {
    expect(hit(item('A-1', { title: 'Fix cve-2026-12345 in parser' }))).toEqual({ name: 'security-id', reason: 'It names the security advisory CVE-2026-12345.' });
    expect(hit(item('A-1', { body: { format: 'markdown', content: 'see GHSA-cfgh-2345-wxjm' } }))?.reason).toContain('GHSA-CFGH-2345-WXJM');
    expect(hit(item('A-1', { body: { format: 'adf', content: { type: 'doc', content: [{ type: 'text', text: 'CVE-2025-0001234' }] } } }))?.name).toBe('security-id');
    // Near misses: too few digits, a GHSA group of the wrong length, no word boundary.
    expect(hit(item('A-1', { title: 'CVE-2026-123' }))).toBeNull();
    expect(hit(item('A-1', { title: 'GHSA-cfgh-2345-wxj' }))).toBeNull();
    expect(hit(item('A-1', { title: 'XCVE-2026-12345' }))).toBeNull();
  });

  it('security-id: only scans the start of a long body', () => {
    const far = `${'a '.repeat(10_001)}CVE-2026-12345`;
    expect(hit(item('A-1', { body: { format: 'markdown', content: far } }))).toBeNull();
  });

  it('incident-link: a link to an incident in the input', () => {
    const incident = item('INC-1', { type: 'INCIDENT', typeName: 'Incident' });
    const linked = item('A-1', { links: [{ type: 'relates', direction: 'outward', target: incident.id, name: 'relates to' }] });
    expect(hit(linked, [incident])).toEqual({ name: 'incident-link', reason: 'It links to the incident INC-1.' });
    expect(hit(linked, [])).toBeNull();
    const other = item('T-1', { type: 'TASK' });
    expect(hit(item('A-2', { links: [{ type: 'relates', direction: 'outward', target: other.id, name: 'relates to' }] }), [other])).toBeNull();
  });

  it('bot-author: a dependency bot as reporter', () => {
    expect(hit(item('A-1', { reporter: { id: 'u1', name: 'dependabot[bot]', email: null } }))?.name).toBe('bot-author');
    expect(hit(item('A-1', { reporter: { id: 'renovate-bot', name: null, email: null } }))?.name).toBe('bot-author');
    expect(hit(item('A-1', { reporter: { id: 'u2', name: 'Pat Example', email: null } }))).toBeNull();
  });

  it('label: one of the keep-the-lights-on labels', () => {
    for (const l of ['security', 'Dependencies', 'COMPLIANCE', 'incident', 'hotfix']) expect(hit(item('A-1', { labels: [l] }))?.name).toBe('label');
    expect(hit(item('A-1', { labels: ['securityx', 'feature'] }))).toBeNull();
  });

  it('title: opens with Bump, Upgrade or Patch as a whole word', () => {
    for (const t of ['Bump lodash', 'upgrade node to 24', 'PATCH the thing', '  Bump: deps']) expect(hit(item('A-1', { title: t }))?.name).toBe('title');
    for (const t of ['Bumper stickers', 'Upgraded plan page', 'Patches page', 'Do not bump this']) expect(hit(item('A-1', { title: t }))).toBeNull();
  });

  it('ranks them in order: type, then id, then link, bot, label, title', () => {
    const all = item('A-1', { type: 'BUG', typeName: 'Bug', title: 'Bump CVE-2026-1111', labels: ['security'] });
    expect(hit(all)?.name).toBe('type');
    expect(hit({ ...all, type: 'TASK' })?.name).toBe('security-id');
    expect(hit({ ...all, type: 'TASK', title: 'Bump x' })?.name).toBe('label');
    expect(hit({ ...all, type: 'TASK', title: 'Bump x', labels: [] })?.name).toBe('title');
  });
});

describe('readCategoryField', () => {
  const t = { field: 'Work category', fieldId: 'customfield_10042' };
  const jira = (fields: Record<string, unknown>, command = 'issue search') => item('A-1', { native: { [`jira ${command}`]: { fields } } });

  it('jira: unknown when not read, null when empty, text otherwise', () => {
    expect(readCategoryField(jira({}), t)).toBeUndefined();
    expect(readCategoryField(item('A-1'), t)).toBeUndefined();
    expect(readCategoryField(jira({ customfield_10042: null }), t)).toBeNull();
    expect(readCategoryField(jira({ customfield_10042: { value: 'KTLO', id: '1' } }), t)).toBe('KTLO');
    expect(readCategoryField(jira({ customfield_10042: { name: 'KTLO' } }), t)).toBe('KTLO');
    expect(readCategoryField(jira({ customfield_10042: 'KTLO' }), t)).toBe('KTLO');
    expect(readCategoryField(jira({ customfield_10042: [{ value: 'Feature' }, { value: 'x' }] }), t)).toBe('Feature');
    expect(readCategoryField(jira({ customfield_10042: [] }), t)).toBeNull();
    expect(readCategoryField(jira({ customfield_10042: 'KTLO' }, 'issue get'), t)).toBe('KTLO');
    expect(readCategoryField(jira({ customfield_10042: 'KTLO' }), { field: 'x' })).toBeUndefined();
    expect(readCategoryField(jira({ customfield_10042: 'KTLO' }), undefined)).toBeUndefined();
  });

  it('ado: reads the reference name from the work item', () => {
    const ado = (command: string, fields: Record<string, unknown>) => item('12', { native: { [`ado ${command}`]: { id: 12, fields } } }, 'ado');
    const target = { field: 'workCategory', fieldId: 'Custom.WorkCategory' };
    expect(readCategoryField(ado('work-item get', { 'Custom.WorkCategory': 'KTLO' }), target)).toBe('KTLO');
    expect(readCategoryField(ado('work-item get-many', { 'Custom.WorkCategory': 'Feature' }), target)).toBe('Feature');
    expect(readCategoryField(ado('work-item get', { 'System.Title': 'x' }), target)).toBeUndefined();
  });

  it('github: reads the project field by name from project items; empty when the board leaves it out', () => {
    const gh = (fieldValues: unknown[]) => item('imagile/payments-web#4', { native: { 'github project items': { id: 'PVTI_1', fieldValues } } }, 'github');
    const target = { field: 'Work category', project: 'imagile/3' };
    expect(readCategoryField(gh([{ field: { name: 'work CATEGORY' }, name: 'KTLO', optionId: 'o1' }]), target)).toBe('KTLO');
    expect(readCategoryField(gh([{ field: { name: 'Status' }, name: 'Done' }]), target)).toBeNull();
    expect(readCategoryField(item('imagile/payments-web#4', { native: { 'github issue get': {} } }, 'github'), target)).toBeUndefined();
  });

  it('is unknown for any other area', () => {
    expect(readCategoryField(item('x', {}, 'bitbucket'), t)).toBeUndefined();
  });
});
