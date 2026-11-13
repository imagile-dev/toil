// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Help, InfoTip } from '../src/components/help.tsx';
import { ICON_NAMES, Icon, PersonGlyph } from '../src/components/icons.tsx';
import { PersonGlyph as ReExported } from '../src/components/avatar.tsx';

/**
 * The icon set and the one (i). An icon is an inline SVG that no theme's font
 * can touch, and an (i) is the same button everywhere: these tests hold both,
 * and a guard fails when a letter is drawn as an icon again.
 */

describe('the icon set', () => {
  it('has the icons the app needs', () => {
    for (const n of ['info', 'help', 'warning', 'error', 'close', 'check', 'chevron-down', 'chevron-right', 'external', 'copy', 'person', 'agent']) expect(ICON_NAMES).toContain(n);
  });

  it.each(ICON_NAMES)('%s is an aria-hidden svg drawn in currentColor, with no text', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.textContent).toBe('');
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('keeps the same stroke on screen at every size', () => {
    const w = (size: number) => {
      const { container } = render(<Icon name="info" size={size} />);
      return (Number(container.querySelector('svg')!.getAttribute('stroke-width')) * size) / 24;
    };
    expect(w(14)).toBeCloseTo(1.5);
    expect(w(20)).toBeCloseTo(1.5);
  });

  it('keeps the person glyph importable from where it used to live', () => {
    expect(ReExported).toBe(PersonGlyph);
    const { container } = render(<PersonGlyph agent />);
    expect(container.querySelector('svg')!.getAttribute('data-glyph')).toBe('agent');
  });
});

describe('the (i) button', () => {
  it('is one named button with the info icon, never a letter', () => {
    render(<Help topic="palette" />);
    const button = screen.getByRole('button', { name: /^About /i });
    expect(button.querySelector('svg[data-icon="info"]')).not.toBeNull();
    expect(button.textContent?.trim()).toBe('');
  });

  it('opens on press and closes on Escape', async () => {
    render(
      <InfoTip label="the thing" tip="A short sentence.">
        <p>The longer words.</p>
      </InfoTip>,
    );
    const button = screen.getByRole('button', { name: 'About the thing' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'About the thing' })).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows its tip when focused with the keyboard', async () => {
    render(
      <InfoTip label="the thing" tip="A short sentence.">
        <p>The longer words.</p>
      </InfoTip>,
    );
    await userEvent.tab();
    expect(await screen.findByRole('tooltip')).toHaveProperty('textContent', 'A short sentence.');
  });
});

describe('no letter drawn as an icon', () => {
  const src = join(import.meta.dirname, '..', 'src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.tsx') || p.endsWith('.css')) files.push(p);
    }
  };
  walk(src);

  it('has no bare i or ? mark, and none of the old (i) classes, outside the shared component', () => {
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      const rel = relative(src, f).replace(/\\/g, '/');
      // The old hand-made (i): a letter inside aria-hidden markup, or the classes that styled it.
      if (/<span[^>]*aria-hidden="true"[^>]*>\s*(i|\?)\s*<\/span>/.test(text)) bad.push(`${rel}: a bare i or ? in a span`);
      if (/help-button|info-button|\.info\s*>\s*summary|<details className="info"/.test(text)) bad.push(`${rel}: an old (i) class`);
      if (/font-style:\s*italic[^}]*Georgia|Georgia[^}]*font-style:\s*italic/.test(text)) bad.push(`${rel}: a serif italic hack, which is how an (i) once got drawn`);
    }
    expect(bad).toEqual([]);
  });
});
