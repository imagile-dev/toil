import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as fn from '../functions/feedback/src/lib/consent.js';
import { feedback as site } from '../site/src/data/feedback.js';
import { CONSENT_VERSION, DISCLAIMER, FEEDBACK_ENDPOINT } from '../src/feedback/consent.js';

/**
 * The feedback disclaimer is one text with one version wherever a report can
 * start (src/feedback/consent.ts). The function and the site are packages of
 * their own and keep copies; this holds every copy, and every place that
 * shows it, to toil's. Toil UI shows the text `toil feedback` returns, so it
 * has no copy to hold.
 */
const repo = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(repo, path), 'utf8').replace(/\r\n/g, '\n');
/** Markdown and Astro wrap long lines, and a quote marks each one; compare with both taken out. */
const flat = (text: string) => text.replace(/^> ?/gm, '').replace(/\s+/g, ' ');

describe('the feedback disclaimer', () => {
  it('is the same text and version in the function, which enforces it', () => {
    expect(fn.DISCLAIMER).toBe(DISCLAIMER);
    expect(fn.CONSENT_VERSION).toBe(CONSENT_VERSION);
  });

  it('is the same on the site, which sends to the same function', () => {
    expect(site.consent).toEqual({ version: CONSENT_VERSION, text: DISCLAIMER });
    expect(FEEDBACK_ENDPOINT).toBe(`${site.endpoint}/api/report`);
    const page = read('site/src/pages/feedback.astro');
    expect(page).toContain('feedback.consent.text');
    expect(page).toContain('feedback.consent.version');
  });

  it('is what the toil skill tells an agent to show before sending', () => {
    expect(flat(read('skills/toil/core.md'))).toContain(DISCLAIMER);
  });

  it('is required by the function on both ways in, as its README says', () => {
    expect(flat(read('functions/feedback/README.md'))).toContain('"consent":1');
  });
});
