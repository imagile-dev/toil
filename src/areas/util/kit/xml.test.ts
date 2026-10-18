import { describe, expect, it } from 'vitest';
import { childElements, localName, parseXml, textOf, XmlSyntaxError, XmlTokenizer, type XmlElement, type XmlEvent } from './xml.js';

/** A JUnit report as Maven Surefire writes one, trimmed and with placeholder names. */
const JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="3" failures="1" errors="0" skipped="1">
  <testsuite name="dev.imagile.api.OrderTest" tests="3" failures="1" errors="0" skipped="1" time="0.042">
    <properties><property name="java.version" value="21"/></properties>
    <testcase name="createsOrder" classname="dev.imagile.api.OrderTest" time="0.010"/>
    <testcase name="rejects &lt;empty&gt; cart" classname="dev.imagile.api.OrderTest" time="0.020">
      <failure message="expected: &quot;400&quot; but was: &quot;200&quot;" type="org.opentest4j.AssertionFailedError"><![CDATA[org.opentest4j.AssertionFailedError: expected: "400" but was: "200"
	at dev.imagile.api.OrderTest.rejectsEmptyCart(OrderTest.java:42)]]></failure>
    </testcase>
    <testcase name="pending" classname="dev.imagile.api.OrderTest" time="0"><skipped/></testcase>
  </testsuite>
</testsuites>
`;

/** Confluence storage format: a fragment, prefixed names, and HTML's entities supplied by the caller. */
const STORAGE = '<p>Runbook&nbsp;v2 &mdash; see below</p><ac:structured-macro ac:name="code"><ac:parameter ac:name="language">bash</ac:parameter><ac:plain-text-body><![CDATA[toil util log build.log]]></ac:plain-text-body></ac:structured-macro><p>Done.</p>';

const events = (text: string, chunkSize: number) => {
  const out: XmlEvent[] = [];
  const tokenizer = new XmlTokenizer((e) => out.push(e));
  for (let at = 0; at < text.length; at += chunkSize) tokenizer.write(text.slice(at, at + chunkSize));
  tokenizer.end();
  // Text may arrive in several pieces; join neighbours so chunkings compare.
  const joined: XmlEvent[] = [];
  for (const e of out) {
    const prev = joined.at(-1);
    if (e.type === 'text' && prev?.type === 'text' && prev.cdata === e.cdata) prev.text += e.text;
    else joined.push({ ...e });
  }
  return joined;
};

const fails = (text: string, message: string | RegExp, options = {}) => {
  let error: unknown;
  try {
    parseXml(text, options);
  } catch (err) {
    error = err;
  }
  expect(error, text).toBeInstanceOf(XmlSyntaxError);
  expect((error as Error).message).toMatch(message);
  return error as XmlSyntaxError;
};

describe('xml', () => {
  it('parses a JUnit report: attributes with entities, CDATA, self-closing and nested elements', () => {
    const [root] = parseXml(JUNIT) as [XmlElement];
    expect(root.name).toBe('testsuites');
    const [suite] = childElements(root, 'testsuite');
    expect(suite!.attrs).toMatchObject({ tests: '3', failures: '1', skipped: '1' });
    const cases = childElements(suite!, 'testcase');
    expect(cases.map((c) => c.attrs.name)).toEqual(['createsOrder', 'rejects <empty> cart', 'pending']);
    const [failure] = childElements(cases[1]!, 'failure');
    expect(failure!.attrs.message).toBe('expected: "400" but was: "200"');
    expect(textOf(failure!)).toContain('OrderTest.java:42');
    expect(failure!.line).toBe(7);
    expect(childElements(cases[2]!, 'skipped')).toHaveLength(1);
  });

  it('gives the same events however the text is chunked, so a report can stream', () => {
    const whole = events(JUNIT, JUNIT.length);
    for (const size of [1, 2, 5, 13, 64]) expect(events(JUNIT, size), `chunks of ${size}`).toEqual(whole);
    expect(whole.filter((e) => e.type === 'open').length).toBe(9);
    expect(whole[0]).toMatchObject({ type: 'pi', target: 'xml' });
  });

  it('reads a storage-format fragment with prefixed names and the entities the caller supplies', () => {
    const nodes = parseXml(STORAGE, { fragment: true, entities: { nbsp: '\u00a0', mdash: '\u2014' } });
    expect(nodes.map((n) => (n.type === 'element' ? n.name : n.type))).toEqual(['p', 'ac:structured-macro', 'p']);
    expect(textOf(nodes[0]!)).toBe('Runbook\u00a0v2 \u2014 see below');
    const macro = nodes[1] as XmlElement;
    expect([localName(macro.name), macro.attrs['ac:name']]).toEqual(['structured-macro', 'code']);
    expect(textOf(childElements(macro, 'plain-text-body')[0]!)).toBe('toil util log build.log');
    // Without them, the same fragment is refused rather than guessed at.
    fails(STORAGE, /"&nbsp;" is not an entity this reader knows/, { fragment: true });
  });

  it('decodes character references and normalises line endings and attribute whitespace', () => {
    const [root] = parseXml('<a t="x\ty\nz">&#65;&#x42;\r\nC&#x1F600;</a>') as [XmlElement];
    expect(root.attrs.t).toBe('x y z');
    expect(textOf(root)).toBe('AB\nC\u{1F600}');
  });

  it('refuses what is not well-formed, saying where', () => {
    expect(fails('<a>\n  <b></a>', '</a> found where </b> was expected')).toMatchObject({ line: 2, column: 6 });
    fails('<a><b></b>', '<a> is never closed');
    fails('<a x="1" x="2"/>', 'has the attribute "x" twice');
    fails('<a>fish & chips</a>', 'A bare "&" must be written &amp;');
    fails('<a/><b/>', '<b> is a second root element');
    fails('text<a/>', 'Text outside the root element');
    fails('<a x=1/>', 'malformed attribute');
    fails('<a x="<"/>', '"<" in the value of "x"');
    fails('<a>&#0;</a>', 'not a valid character reference');
    fails('', 'There is no root element');
    fails('<a><!-- never closed', 'The document ends inside markup');
  });

  it('applies nothing a DOCTYPE declares, so an entity bomb is just an unknown entity', () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><lolz>&lol2;</lolz>';
    fails(bomb, '"&lol2;" is not an entity this reader knows');
    const out: XmlEvent[] = [];
    const t = new XmlTokenizer((e) => out.push(e));
    t.write('<!DOCTYPE note SYSTEM "Note.dtd"><note/>');
    t.end();
    expect(out[0]).toMatchObject({ type: 'doctype', body: 'note SYSTEM "Note.dtd"' });
  });

  it('keeps comments only when asked, and refuses a construct longer than the cap', () => {
    expect(parseXml('<a><!-- why -->x</a>', { comments: true })[0]).toMatchObject({ children: [{ type: 'comment', text: ' why ' }, { type: 'text', text: 'x' }] });
    expect(parseXml('<a><!-- why -->x</a>')[0]).toMatchObject({ children: [{ type: 'text', text: 'x' }] });
    const t = new XmlTokenizer(() => {}, { maxToken: 10 });
    expect(() => t.write('<a><!-- this comment is long')).toThrow(/longer than 10 characters/);
  });

  it('streams a large report in time linear in its size', () => {
    const testcase = '<testcase name="case" classname="dev.imagile.api.OrderTest" time="0.001"><system-out>ok &amp; done</system-out></testcase>\n';
    const body = testcase.repeat(40_000);
    const text = `<testsuite tests="40000">${body}</testsuite>`;
    let opened = 0;
    const started = performance.now();
    const tokenizer = new XmlTokenizer((e) => {
      if (e.type === 'open' && e.name === 'testcase') opened++;
    });
    for (let at = 0; at < text.length; at += 64 * 1024) tokenizer.write(text.slice(at, at + 64 * 1024));
    tokenizer.end();
    expect(opened).toBe(40_000);
    expect(performance.now() - started, `${text.length} characters`).toBeLessThan(3000);
  });

  it('gives the same events, or the same error, wherever the input is split in two', () => {
    const split = (text: string, at: number) => {
      const out: XmlEvent[] = [];
      const tokenizer = new XmlTokenizer((e) => out.push(e));
      tokenizer.write(text.slice(0, at));
      tokenizer.write(text.slice(at));
      tokenizer.end();
      return out.reduce<XmlEvent[]>((joined, e) => {
        const prev = joined.at(-1);
        if (e.type === 'text' && prev?.type === 'text' && prev.cdata === e.cdata) prev.text += e.text;
        else joined.push({ ...e });
        return joined;
      }, []);
    };
    const valid = '<a k="v">x] y]] z&amp;w\r\nq<![CDATA[c]]>]]<!-- n --><b/>&#65;</a>';
    const whole = split(valid, valid.length);
    for (let at = 0; at <= valid.length; at++) expect(split(valid, at), `split at ${at}`).toEqual(whole);
    const invalid = '<a>x]]>y</a>';
    for (let at = 0; at <= invalid.length; at++) expect(() => split(invalid, at), `split at ${at}`).toThrow('"]]>" is not allowed in text');
  });
});
