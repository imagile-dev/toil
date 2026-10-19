// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/css-tokens.ts';
import { isThemePath, userCssProblems } from '../src/theme-rules.ts';

/**
 * A user theme's stylesheet is read through a CSS tokenizer that follows the
 * CSS Syntax spec, so escapes are decoded and strings taken whole before
 * anything is checked. These are the ways past a regular expression over the
 * raw text, each refused. The toil-ui server's Content-Security-Policy holds
 * whatever this misses (test/server.test.ts).
 */

const ok = (css: string) => expect(userCssProblems(css)).toEqual([]);
const refused = (css: string, reason: RegExp) => expect(userCssProblems(css).join('\n')).toMatch(reason);

describe("a user theme's stylesheet, read as the browser reads it", () => {
  it.each([
    // The five ways past a regular expression that review found (#259).
    ['a quoted ) inside url()', String.raw`a { background: url("https://tracker.imagile.dev/x).png"); }`, /leaves the theme's folder/],
    ['an escaped url function name', String.raw`a { background: \75 rl(https://tracker.imagile.dev/x.png); }`, /leaves the theme's folder/],
    ['an escaped scheme', String.raw`a { background: url(htt\70 s://tracker.imagile.dev/x.png); }`, /url\("https:\/\/tracker\.imagile\.dev\/x\.png"\) leaves/],
    ['a string in image-set()', String.raw`a { background: image-set("https://tracker.imagile.dev/x.png" 1x); }`, /leaves the theme's folder/],
    ['an escaped @import', String.raw`@\69mport "https://tracker.imagile.dev/x.css";`, /not @import/],
    // More of the same family.
    ['-webkit-image-set()', String.raw`a { background: -webkit-image-set(url(//tracker.imagile.dev/x.png) 1x); }`, /leaves/],
    ['cross-fade()', String.raw`a { background: cross-fade("https://tracker.imagile.dev/a.png", "assets/b.png", 50%); }`, /leaves/],
    ['image()', String.raw`a { background: image("https://tracker.imagile.dev/a.png"); }`, /leaves/],
    ['src()', String.raw`a { background: src("https://tracker.imagile.dev/a.png"); }`, /leaves/],
    ['an upper-case URL()', String.raw`a { background: URL(https://tracker.imagile.dev/a.png); }`, /leaves/],
    ['a url() with spaces round a quoted value', String.raw`a { background: url(  "//tracker.imagile.dev/a.png"  ); }`, /leaves/],
    ['a percent-encoded parent', String.raw`a { background: url(%2e%2e/secret.png); }`, /leaves/],
    ['an escaped slash and parent', String.raw`a { background: url(assets\2f..\2f..\2fx.png); }`, /leaves/],
    ['a backslash path', String.raw`a { background: url("assets\\..\\x.png"); }`, /leaves/],
    ['a data: URL', String.raw`a { background: url("data:image/svg+xml,<svg/>"); }`, /leaves/],
    ['a root-relative path', String.raw`a { background: url(/x.png); }`, /leaves/],
    ['an empty url()', String.raw`a { background: url(); }`, /leaves/],
    ['a font from another host', String.raw`@font-face { font-family: X; src: url("https://fonts.imagile.dev/x.woff2") format("woff2"); }`, /leaves/],
    ['@namespace', String.raw`@namespace svg url(http://www.w3.org/2000/svg);`, /not @namespace/],
    ['@charset', String.raw`@charset "utf-8";`, /not @charset/],
    ['@layer', String.raw`@layer base { a { color: red; } }`, /not @layer/],
    ['a six-digit escaped @import', String.raw`@\000069 mport url(x.css);`, /not @import/],
    ['element()', String.raw`a { background: element(#secret); }`, /may not use element\(\)/],
    ['an escaped expression()', String.raw`a { width: expr\65 ssion(alert(1)); }`, /may not use expression\(\)/],
    ['an escaped javascript: url', String.raw`a { background: url(java\73 cript:alert(1)); }`, /leaves|runs script|malformed/],
    ['an escaped javascript: url, quoted', String.raw`a { background: url("java\73 cript:alert(1)"); }`, /leaves|runs script/],
    ['-moz-binding', String.raw`a { -moz-binding: url(assets/x.xml); }`, /runs script/],
    ['a bad url()', String.raw`a { background: url(assets/a b.png); }`, /malformed/],
    ['a string broken by a newline', 'a { content: "x\n"; }', /malformed/],
  ])('refuses %s', (_, css, reason) => refused(css, reason));

  it('allows what a theme needs: its own files, @media, @supports, @font-face and @keyframes, and strings that load nothing', () => {
    ok(String.raw`
      @font-face { font-family: 'Mine'; src: local('Mine'), url("assets/mine.woff2") format("woff2"); }
      [data-theme="mine"] body { background: url(assets/bg.svg) 0 0 / 32px, image-set("assets/bg.webp" 1x, url(assets/bg-2x.webp) 2x); font-family: 'Mine', serif; }
      [data-theme="mine"] a::after { content: "\2192  https://not.a.request.imagile.dev"; }
      @media (prefers-reduced-motion: no-preference) { [data-theme="mine"] a { animation: spin 1s; } }
      @supports (display: grid) { [data-theme="mine"] main { display: grid; } }
      @keyframes spin { from { rotate: 0deg; } to { rotate: 360deg; } }
      /* @import "https://tracker.imagile.dev/x.css"; is only a comment */
    `);
  });

  it('holds every built-in theme to the same rules, less the fonts they @import from their own package', () => {
    for (const name of ['plain', 'crate', 'harvest', 'starship', 'realm']) {
      const css = readFileSync(join(import.meta.dirname, '..', 'themes', name, 'theme.css'), 'utf8').replace(/@import '@fontsource\/[^']+';/g, '');
      expect(userCssProblems(css), name).toEqual([]);
    }
  });

  it('tokenizes escapes, strings and comments as the CSS Syntax spec says', () => {
    expect(tokenize(String.raw`\75 rl(a)`)).toEqual([{ type: 'url', value: 'a' }]);
    expect(tokenize('"a\\"b\\\nc"')).toEqual([{ type: 'string', value: 'a"bc' }]);
    expect(tokenize(String.raw`@\69mport`)).toEqual([{ type: 'at-keyword', value: 'import' }]);
    expect(tokenize('a/* x */b').map((t) => t.type)).toEqual(['ident', 'ident']);
    expect(tokenize('url( "x" )').slice(0, 3)).toEqual([{ type: 'function', value: 'url' }, { type: 'whitespace' }, { type: 'string', value: 'x' }]);
    expect(tokenize(String.raw`\0 a`)).toEqual([{ type: 'ident', value: '\uFFFDa' }]);
    expect(tokenize('a\r\nb').map((t) => t.type)).toEqual(['ident', 'whitespace', 'ident']);
  });

  it('knows a theme path from one that leaves the folder', () => {
    for (const p of ['assets/a.png', './assets/a.png', 'a.svg', 'assets/sub/b-1_2.webp']) expect(isThemePath(p), p).toBe(true);
    for (const p of ['', '../a.png', 'assets/../../a.png', '././a.png', './../a.png', '/a.png', 'a\\b.png', 'https://x', '//x', 'a?b', 'a#b', '%2e%2e/a', 'assets//a']) expect(isThemePath(p), p).toBe(false);
  });
});
