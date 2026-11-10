import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { ChatScope } from '../src/components/ask.tsx';
import { memoryAnalyses } from '../src/analyses.ts';
import { DataContext, type Data } from '../src/data.ts';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import type { ToilProjectData } from '../src/load.ts';
import { openWorkSpec } from '../src/model/lanes.ts';
import { buildInsights } from '../src/model/work-insights.ts';
import { people } from '../src/model/people.ts';
import { SkinProvider, skinsFor } from '../src/skins.tsx';
import { PersonMix } from '../src/views/person-mix.tsx';
import { peopleByTeam } from '../src/views/People.tsx';
import { loaded } from './harness.ts';

/** The People view's mix bar and its team headings (#567, seats M7 and M9), on the sample team. */

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

const TEAM = '#/project/sample-team';
const open = (hash: string) => {
  window.location.hash = hash;
  return render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} now={FIXTURE_NOW} preview />);
};
const go = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
};
const until = <T extends Element>(selector: string) =>
  waitFor(
    () => {
      const el = document.querySelector<T>(selector);
      if (!el) throw new Error(`no ${selector} yet`);
      return el;
    },
    { timeout: 8000 },
  );

function shell(toilProject: ToilProjectData, children: React.ReactNode) {
  const data: Data = { toilProject, byId: new Map(toilProject.items.map((i) => [i.id, i])), prById: new Map(), agent: scriptedAgent(), now: FIXTURE_NOW, analyses: memoryAnalyses() };
  return render(
    <SkinProvider value={skinsFor('plain')}>
      <DataContext value={data}>
        <ChatScope>{children}</ChatScope>
      </DataContext>
    </SkinProvider>,
  );
}

describe('the mix of open work on each person card', () => {
  it('is one bar per person whose total is that person\'s open items, with no ordering change', async () => {
    const { data } = await loaded('sample-team');
    const ins = buildInsights(data, FIXTURE_NOW);
    open(`${TEAM}/people`);
    await until('[data-person-mix="category"]');
    const cards = [...document.querySelectorAll<HTMLElement>('.people-cards .person-card')];
    expect(cards.length).toBeGreaterThan(5);
    let bars = 0;
    for (const card of cards) {
      const name = card.querySelector('h3')!.textContent!;
      const mix = card.querySelector('[data-person-mix]');
      const openItems = ins.items.filter((i) => ins.valueText(i, 'assignee') === name && i.statusCategory !== 'DONE');
      if (openItems.length === 0) {
        expect(mix, name).toBeNull();
        continue;
      }
      bars++;
      // One bar: a single group of segments, no score or ranking beside it.
      expect(card.querySelectorAll('[data-person-mix]'), name).toHaveLength(1);
      expect(card.querySelectorAll('[data-person-mix] svg[role="group"]'), name).toHaveLength(1);
      expect(ins.run(openWorkSpec(name, 'category')).total.value, name).toBe(openItems.length);
    }
    expect(bars).toBeGreaterThan(3);
  });

  it('shows nothing for a person with no open work, and a dash for a dimension nobody read', async () => {
    const { data } = await loaded('sample-team');
    const { container } = shell(data, <PersonMix name="Nobody At All" dimension="category" />);
    expect(container.querySelector('[data-person-mix]')).toBeNull();
    cleanup();
    const card = (await loaded('card-payments')).data;
    const view = shell(card, <PersonMix name={card.people[0]!.name} dimension="release" />);
    const unread = view.container.querySelector('[data-person-mix="unread"]')!;
    expect(unread.querySelector('[aria-label$="not read yet"]')).toBeTruthy();
    expect(unread.querySelector('svg')).toBeNull();
  });

  it('changes dimension for every card from one menu, kept in the address, and a segment opens its items', async () => {
    open(`${TEAM}/people`);
    await until('[data-person-mix="category"]');
    await go(`${TEAM}/people?mix=release`);
    await waitFor(() => expect(document.querySelectorAll('[data-person-mix="release"]').length).toBeGreaterThan(3));
    expect(document.querySelectorAll('[data-person-mix="category"]')).toHaveLength(0);
    expect(document.querySelector('[data-picker="Show each person\'s work by"]')!.textContent).toContain('Fix version');
    const segment = document.querySelector<SVGElement>('[data-person-mix="release"] svg[role="group"] [tabindex]')!;
    expect(segment).toBeTruthy();
    await act(async () => {
      segment.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(window.location.hash).toContain('items=cell%7C'));
    expect(window.location.hash).toContain('mix=release');
    const drawer = await until<HTMLElement>('[data-drill]');
    expect(Number(drawer.getAttribute('data-drill'))).toBeGreaterThan(0);
  });
});

describe('teams on the People view', () => {
  it('puts the cards under team headings in name order, people in name order inside', async () => {
    open(`${TEAM}/people`);
    await until('[data-team]');
    const teams = [...document.querySelectorAll<HTMLElement>('[data-team]')];
    expect(teams.map((t) => t.dataset.team)).toEqual(['Platform', 'Storefront']);
    for (const t of teams) {
      const names = [...t.querySelectorAll('.person-card h3')].map((h) => h.textContent!);
      expect(names.length).toBeGreaterThan(1);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      expect(t.querySelector('.people-team__head')!.textContent).toMatch(/\d+ (people|person), \d+ in progress/);
    }
    // The agent is a member of its team like any other.
    expect(teams[0]!.textContent).toContain('Copilot');
    expect(screen.queryByText(/rank|score/i)).toBeNull();
  });

  it('keeps today\'s flat layout where nobody has a team', async () => {
    const { data } = await loaded('card-payments');
    const view = people({ toilProject: data.name, entries: data.people ?? [], wipLimit: data.wipLimit ?? null, items: data.items, changes: data.pullRequests ?? [], now: FIXTURE_NOW });
    expect(peopleByTeam(view.people, data.people ?? [])).toBeNull();
    open('#/project/card-payments/people');
    await until('.people-cards');
    expect(document.querySelectorAll('[data-team]')).toHaveLength(0);
  });
});
