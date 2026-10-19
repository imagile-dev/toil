import { describe, expect, it } from 'vitest';
import { citationsOf, segments } from '../src/agent.ts';
import { SCRIPTS, scriptedAgent } from '../src/fixtures/agent.ts';
import { FIXTURE_NOW } from '../src/fixtures/execute.ts';
import { needsAttention, prepare } from '../src/model/insights.ts';
import { NAMES, healthOf } from './harness.ts';

/**
 * The scripted Agent against what each dashboard loads: every figure and
 * citation in its answers is recomputed from the dossier's data, so the
 * script can't drift from the fixture `execute()`.
 */

const agent = scriptedAgent();
const sorted = (a: string[]) => [...new Set(a)].sort();
const cites = (text: string) => segments(text).flatMap((s) => ('cite' in s ? [s.cite] : []));
const text = async (dossier: string, id: string) => (await agent.ask(dossier, id)).parts.map((p) => p.text).join(' ');

describe('the scripted agent', () => {
  it.each(NAMES)('offers the same three starters for %s', (name) => {
    expect(agent.starters(name).map((s) => s.label)).toEqual(["What's at risk in this dossier?", 'What needs attention first?', 'Where is this work deployed?']);
  });

  it('streams each answer as it grows, never splitting a citation, and ends on the whole answer', async () => {
    const seen: string[] = [];
    let last;
    for await (const partial of agent.stream!('card-payments', 'risk')) {
      seen.push(partial.parts.map((p) => p.text).join(' '));
      for (const p of partial.parts) expect(p.text.match(/\[\[/g)?.length ?? 0).toBe(p.text.match(/\]\]/g)?.length ?? 0);
      last = partial;
    }
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.every((s, i) => i === 0 || s.length >= seen[i - 1]!.length)).toBe(true);
    expect(last).toEqual(await agent.ask('card-payments', 'risk'));
  });

  it('stops streaming when the signal aborts', async () => {
    const controller = new AbortController();
    let n = 0;
    for await (const partial of agent.stream!('settlement', 'risk', controller.signal)) {
      expect(partial.prompt).toBe("What's at risk in this dossier?");
      if (++n === 3) controller.abort();
    }
    expect(n).toBe(3);
  });

  it.each(NAMES)("cites only %s's own items, and every answer cites some", async (name) => {
    const { byId } = await healthOf(name);
    for (const { id } of agent.starters(name)) {
      const answer = await agent.ask(name, id);
      expect(answer.by).toBe('scripted');
      expect(answer.citations).toEqual(citationsOf(answer.parts));
      expect(answer.citations.length).toBeGreaterThan(0);
      for (const cite of answer.citations) expect(byId.has(cite), cite).toBe(true);
    }
  });

  it('answers by label as well as by id, and only for the dossier asked about', async () => {
    expect((await agent.ask('settlement', 'Where is this work deployed?')).parts).toEqual((await agent.ask('settlement', 'deployed')).parts);
    expect((await agent.ask('settlement', 'risk')).parts).not.toEqual((await agent.ask('checkout-web', 'risk')).parts);
  });

  it('says plainly when a question is outside the script', async () => {
    const answer = await agent.ask('card-payments', 'What should we cut?');
    expect(answer.citations).toEqual([]);
    expect(answer.parts[0]!.text).toMatch(/only its starter questions/);
    expect(agent.starters('no-such-dossier')).toEqual([]);
  });
});

describe.each(NAMES)('the %s script agrees with the model', (name) => {
  it('quotes the sprint figures health() computes', async () => {
    const { h } = await healthOf(name);
    const risk = await text(name, 'risk');
    const total = h.done.points + h.remaining.points;
    expect(risk).toContain(`day ${h.days.gone} of ${h.days.total}`);
    expect(risk).toMatch(new RegExp(`${h.done.points} of ${total} points (is|are) done and ${h.remaining.points} remain`));
    for (const id of h.otherUnits) expect(cites(risk)).toContain(id);
  });

  it('cites every risky item, blocker, item added and carry-over', async () => {
    const { h, byId } = await healthOf(name);
    const cited = (await agent.ask(name, 'risk')).citations;
    const blockers = h.risks.flatMap((r) => r.reasons.flatMap((x) => (x.code === 'blocked' ? [x.by] : [])));
    const kind = (k: string) => h.items.filter((i) => h.entries.get(i.id)!.kind === k).map((i) => i.id);
    expect(cited).toEqual(expect.arrayContaining(sorted([...h.risks.map((r) => r.id), ...blockers, ...kind('added'), ...kind('carried')])));
    const blocked = h.risks.filter((r) => r.reasons.some((x) => x.code === 'blocked')).map((r) => byId.get(r.id)!.estimate?.value ?? 0);
    if (blocked.length > 1) expect(await text(name, 'risk')).toContain(`holding ${blocked.reduce((a, b) => a + b, 0)} points back`);
  });

  it('names every environment, its commit, and exactly the items running there', async () => {
    const { data } = await healthOf(name);
    const answer = await agent.ask(name, 'deployed');
    for (const d of data.deployments) {
      const part = answer.parts.find((p) => p.text.includes(`The ${d.environment} environment runs`))!;
      expect(part, d.environment).toBeDefined();
      expect(part.text).toContain(`(${d.commit})`);
      if (d.items.length) expect(sorted(cites(part.text))).toEqual(sorted(d.items.filter((id) => data.items.find((i) => i.id === id)?.type !== 'EPIC')));
    }
    // And the items with a pull request still open are named as not deployed.
    const open = data.changes.filter((c) => c.kind === 'pull-request' && c.outcome === 'open').flatMap((c) => c.items);
    const sprintOpen = open.filter((id) => data.items.find((i) => i.id === id)?.type !== 'EPIC' && data.items.find((i) => i.id === id)?.type !== 'OTHER');
    expect(sorted(cites(answer.parts.at(-1)!.text))).toEqual(sorted(sprintOpen));
  });
});

describe.each(NAMES)('the %s attention answer agrees with the insights', (name) => {
  it('takes the top items in rank order, one paragraph each, with their figures', async () => {
    const { data, h } = await healthOf(name);
    const ranked = needsAttention(prepare({ items: data.items, changes: data.changes, deployments: data.deployments, health: h, now: FIXTURE_NOW }));
    const answer = await agent.ask(name, 'attention');
    expect(answer.parts.length).toBe(Math.min(3, ranked.length));
    answer.parts.forEach((part, i) => {
      expect(cites(part.text)[0], part.text).toBe(ranked[i]!.id);
      for (const insight of ranked[i]!.insights) for (const n of insight.text.match(/\d+(\.\d+)? days?/g) ?? []) expect(part.text, insight.text).toContain(n.replace(/ days?$/, ''));
    });
  });

  it('offers proposals only on items it cites', async () => {
    for (const { id } of agent.starters(name)) {
      const answer = await agent.ask(name, id);
      for (const p of answer.proposals) {
        expect(answer.citations).toContain(p.item);
        expect(p.from).toBe('agent');
      }
    }
  });
});

describe('the scripts', () => {
  it('cover every dossier the fixture serves', () => {
    expect(Object.keys(SCRIPTS).sort()).toEqual([...NAMES].sort());
  });
});
