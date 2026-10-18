import { describe, expect, it } from 'vitest';
import { citationsOf, segments } from '../src/agent.ts';
import { SCRIPT, scriptedAgent } from '../src/fixtures/agent.ts';
import { CHANGES } from '../src/fixtures/changes.ts';
import { FIXTURE_ITEMS, FIXTURE_NOW } from '../src/fixtures/store.ts';
import { health } from '../src/model/sprint.ts';

const agent = scriptedAgent();
const byId = new Map(FIXTURE_ITEMS.map((i) => [i.id, i]));
const h = health(FIXTURE_ITEMS, CHANGES, FIXTURE_NOW)!;
const kind = (k: string) => h.items.filter((i) => h.entries.get(i.id)!.kind === k).map((i) => i.id);
const text = async (id: string) => (await agent.ask(id)).parts.map((p) => p.text).join(' ');
const sorted = (a: string[]) => [...a].sort();
const cites = (text: string) => segments(text).flatMap((s) => ('cite' in s ? [s.cite] : []));

describe('the scripted agent', () => {
  it('offers its three starters', () => {
    expect(agent.starters().map((s) => s.label)).toEqual(['Why is this sprint at risk?', 'Give me a stand-up digest', "What's unestimated or orphaned?"]);
  });

  it('cites the items every answer rests on, and only items the Store holds', async () => {
    for (const { id } of agent.starters()) {
      const answer = await agent.ask(id);
      expect(answer.by).toBe('scripted');
      expect(answer.citations).toEqual(citationsOf(answer.parts));
      expect(answer.citations.length).toBeGreaterThan(0);
      for (const cite of answer.citations) expect(byId.has(cite), cite).toBe(true);
    }
  });

  it('answers by label as well as by id', async () => {
    expect((await agent.ask('Why is this sprint at risk?')).parts).toEqual((await agent.ask('risk')).parts);
  });

  it('says plainly when a question is outside the script', async () => {
    const answer = await agent.ask('What should we cut?');
    expect(answer.citations).toEqual([]);
    expect(answer.parts[0]!.text).toMatch(/only its starter questions/);
  });
});

describe('the script agrees with the model', () => {
  it('quotes the sprint figures health() computes', async () => {
    const risk = await text('risk');
    const total = h.done.points + h.remaining.points;
    expect(risk).toContain(`day ${h.days.gone} of ${h.days.total}`);
    expect(risk).toContain(`${h.done.points} of ${total} points are done and ${h.remaining.points} remain`);
    expect(risk).toContain(`${h.added.count} items and ${h.added.points} points`);
    const blocked = h.risks.filter((r) => r.reasons.some((x) => x.code === 'blocked')).map((r) => byId.get(r.id)!.estimate!.value);
    expect(risk).toContain(`hold ${blocked.reduce((a, b) => a + b, 0)} points back`);
  });

  it('cites every blocked chain, failing build, item added and carry-over in the risk answer', async () => {
    const cited = (await agent.ask('risk')).citations;
    const blockers = h.risks.flatMap((r) => r.reasons.flatMap((x) => (x.code === 'blocked' ? [x.by] : [])));
    const risky = h.risks.filter((r) => r.reasons.some((x) => x.code !== 'unestimated')).map((r) => r.id);
    expect(sorted(cited)).toEqual(sorted([...new Set([...risky, ...blockers, ...kind('added'), ...kind('carried')])]));
  });

  it('lists exactly the unestimated and orphaned items', () => {
    const [unestimated, orphaned] = SCRIPT.hygiene!.parts.map(cites);
    expect(sorted(unestimated!)).toEqual(sorted(h.unestimated));
    const parentless = h.items.filter((i) => (i.type === 'STORY' || i.type === 'TASK') && !i.parent && i.statusCategory !== 'DONE').map((i) => i.id);
    expect(sorted(orphaned!)).toEqual(sorted(parentless));
  });

  it('names every unassigned item not yet started in the stand-up', () => {
    const idle = h.items.filter((i) => i.statusCategory === 'TODO' && !i.assignee).map((i) => i.id);
    expect(sorted(cites(SCRIPT.standup!.parts.at(-1)!))).toEqual(sorted(idle));
  });
});
