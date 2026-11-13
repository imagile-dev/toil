import { describe, expect, it } from 'vitest';
import { EXTERNAL, EXTERNAL_PERSON, FILL } from '../src/components/c4-picture.tsx';

/**
 * The text in the architecture picture's boxes (#582): every fill with the
 * colour its words are drawn in, held to 4.5 to 1 (WCAG 2.2 AA, for text this
 * small). The notation's own white on the container blue and the external grey
 * is not, which is why those two are black here. Computed, not eyeballed.
 */

const channel = (hex: string, at: number) => {
  const v = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
};

describe('the picture’s box colours', () => {
  const pairs: Array<[string, { fill: string; font: string }]> = [...Object.entries(FILL), ['external person', EXTERNAL_PERSON], ['external system', EXTERNAL]];

  it('computes the ratio the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#438dd5')).toBeCloseTo(3.49, 1);
  });

  it.each(pairs)('%s: its text is at least 4.5 to 1 against its fill', (_name, colour) => {
    expect(contrast(colour.fill, colour.font)).toBeGreaterThanOrEqual(4.5);
  });
});
