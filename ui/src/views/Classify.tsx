/**
 * Sort work into categories (#566): the Board's third view, beside the Board
 * and "Ready to start?". It lists what needs a person, the unsure items and the
 * ones where a rule or signal and a label already on the item disagree, each
 * with the category toil would suggest and why, and a row of choices: the
 * scheme's categories by their plain names, then Unsure. K, F and U pick (1 to 9
 * for any other scheme), Enter confirms and moves to the next row. A choice is
 * a person's word, saved in their own record at once; the tracker changes only
 * when they apply it, on an approval card that shows every change first.
 *
 * "Ask your AI agent" gives the agent toil's own question for the unsure items
 * and shows what comes back as suggestions with the agent's reason and badge,
 * which a person accepts one by one or all together. The agent has no way to
 * apply anything. "How it's doing" is folded at the top. Nothing here is a
 * score of a person: the figures are about the categories. Fourteen decisions
 * that each took a meeting, in a column that takes a keystroke.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Radio, RadioGroup, Select, SelectValue, Popover, ListBox, ListBoxItem } from 'react-aria-components';
import type { AgentChoice, ApplyWork } from '../classify-api.ts';
import { ApplyCard, byConnection } from '../components/classify-apply.tsx';
import { HowItsDoing } from '../components/classify-doing.tsx';
import { CategoryName } from '../components/category-chip.tsx';
import { Empty, EmptyButton, EmptyLink, TrackerAction } from '../components/empty.tsx';
import { FilterBar } from '../components/filter-bar.tsx';
import { Help } from '../components/help.tsx';
import { ItemLink } from '../components/items.tsx';
import { useClassify } from '../classify-state.tsx';
import { useData } from '../data.ts';
import { toWhere } from '../filters.ts';
import { chartsHref, toilProjectHref } from '../format.ts';
import { useAddress, useWorkInsights } from '../insights-data.ts';
import { choiceForKey, choicesOf, sourcePhrase, workRead, type NeedsRow } from '../model/classify.ts';
import { usePlain } from '../plain-words.ts';
import { matches, matchesAny, typingIn } from '../shortcuts.ts';
import { useWords } from '../skins.tsx';
import { plainDates } from './charts/format.ts';
import '../components/classify.css';

/** The most items one question to the agent holds from this view: more than a person would sort in a sitting. */
export const ASK_AT_MOST = 100;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The key a press of this event means for a row's choices, or null: letters from the shortcut table, digits for the numbered schemes. */
export function pickKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): string | null {
  if (matches('classifyK', e)) return 'K';
  if (matches('classifyF', e)) return 'F';
  if (matches('classifyU', e)) return 'U';
  if (matchesAny('classifyDigit', e)) return e.key;
  return null;
}

function Why({ row, follow }: { row: NeedsRow; follow: number }) {
  const ins = useWorkInsights();
  const name = (id: string | null) => (id ? (ins.definitions[id]?.name ?? id) : 'Unsure');
  const children = follow > 0 ? ` ${plural(follow, 'item')} under it in this list ${follow === 1 ? 'follows' : 'follow'} its answer.` : '';
  if (row.kind === 'unsure') return <p className="sortrow__why note">Nothing has settled this one: no label, rule or parent says what it is.{children}</p>;
  const now = row.carried!;
  const fresh = row.suggested!;
  return (
    <p className="sortrow__why note">
      It says {name(now.category)} ({sourcePhrase(now.source)}), but {sourcePhrase(fresh.source)} says {name(fresh.category)}: {fresh.reason}
      {children}
    </p>
  );
}

/** A radio is an <input> but takes no typing: a mouse pick leaves focus on it, and the row's keys still work there. */
const isRadio = (t: EventTarget) => t instanceof HTMLInputElement && t.type === 'radio';

function Row({ row, picked, onPick, onConfirm, onAccept, busy, follow }: { row: NeedsRow; picked: string | undefined; onPick: (value: string) => void; onConfirm: () => void; onAccept: () => void; busy: boolean; follow: number }) {
  const ins = useWorkInsights();
  const { proposals, dismiss } = useClassify();
  const choices = choicesOf(ins.scheme);
  const proposal = proposals.get(row.item.id);
  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (typingIn(e.target) && !isRadio(e.target)) return;
    const key = pickKey(e);
    const choice = key ? choiceForKey(choices, key) : undefined;
    if (choice) {
      e.preventDefault();
      onPick(choice.id ?? 'unsure');
    }
  };
  // Enter is read on the way down, because the radios and buttons inside the row stop the key from rising to the row.
  // On one of the row's own buttons it presses that button and on a link it follows the link; anywhere else in the row,
  // a radio the mouse just picked included, it confirms the pick. A text field keeps its own Enter.
  const onEnter = (e: KeyboardEvent<HTMLLIElement>) => {
    if (!matches('classifyConfirm', e) || (typingIn(e.target) && !isRadio(e.target))) return;
    if (e.target instanceof HTMLElement && e.target.closest('button, a')) return;
    e.preventDefault();
    onConfirm();
  };
  return (
    <li className="sortrow" data-row={row.item.id} data-kind={row.kind} tabIndex={0} onKeyDown={onKeyDown} onKeyDownCapture={onEnter} aria-label={`${row.item.source.key} ${row.item.title}`}>
      <p className="sortrow__head">
        <ItemLink id={row.item.id} withTitle />
      </p>
      <Why row={row} follow={follow} />
      {proposal && (
        <div className="sortrow__proposal" data-proposal={row.item.id}>
          <p>
            <span className="badge badge--agent">Your AI agent</span> suggests <CategoryName ins={ins} id={proposal.category} />: {proposal.reason}
          </p>
          <div className="sortrow__proposal-actions">
            <Button className="btn btn--small" onPress={onAccept} isDisabled={busy} data-accept="">
              Accept
            </Button>
            <Button className="btn btn--small btn--quiet" onPress={() => dismiss([row.item.id])}>
              Not this
            </Button>
          </div>
        </div>
      )}
      <RadioGroup className="sortrow__choices" orientation="horizontal" aria-label={`Category for ${row.item.source.key}`} value={picked ?? ''} onChange={onPick}>
        {choices.map((c) => (
          <Radio key={c.id ?? 'unsure'} value={c.id ?? 'unsure'} className="sortrow__choice" data-choice={c.id ?? 'unsure'} aria-keyshortcuts={c.key}>
            {c.name} <kbd className="sortrow__key">{c.key}</kbd>
          </Radio>
        ))}
      </RadioGroup>
      <div className="sortrow__actions">
        <Button className="btn btn--small btn--accent" onPress={onConfirm} isDisabled={busy || picked === undefined} data-confirm="">
          Confirm
        </Button>
      </div>
    </li>
  );
}

export function Classify() {
  const { toilProject, now, sync } = useData();
  const plain = usePlain();
  const words = useWords();
  const ins = useWorkInsights();
  const { filters } = useAddress();
  const c = useClassify();
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState<{ by: string; count: number; warnings: string[]; omitted: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentChoice[]>([]);
  const [adapter, setAdapter] = useState<string | undefined>(undefined);
  // The cards are a snapshot of what was decided when Review and apply was pressed, so the result stays on screen after Apply empties the waiting list.
  const [cards, setCards] = useState<Array<{ connection: string; work: ApplyWork }> | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    c.api?.agents().then((a) => live && setAgents(a), () => live && setAgents([]));
    return () => {
      live = false;
    };
  }, [c.api]);

  const allowed = useMemo(() => {
    const where = toWhere(filters);
    return where.length === 0 ? null : new Set(ins.narrow(where).items.map((i) => i.id));
  }, [ins, filters]);
  const rows = c.needs.filter((r) => !allowed || allowed.has(r.item.id));
  // A disagreement starts on what the rules say, which a person confirms or changes; an unsure item starts on nothing.
  const pickOf = (r: NeedsRow) => picks[r.item.id] ?? (r.kind === 'disagree' ? (r.suggested!.category ?? undefined) : undefined);
  const pending = c.pending.filter((p) => !allowed || allowed.has(p.item.id));
  // An answer on an epic is every task under it too, so a row says how many of the rows below it follow it.
  const followers = useMemo(() => {
    const byId = new Map(ins.items.map((i) => [i.id, i]));
    const inList = new Set(rows.map((r) => r.item.id));
    const out = new Map<string, number>();
    for (const r of rows) {
      const seen = new Set<string>([r.item.id]);
      for (let up = r.item.parent; up && !seen.has(up); up = byId.get(up)?.parent ?? null) {
        seen.add(up);
        if (inList.has(up)) out.set(up, (out.get(up) ?? 0) + 1);
      }
    }
    return out;
  }, [ins.items, c.needs, allowed]);
  const unsure = rows.filter((r) => r.kind === 'unsure' && !c.proposals.has(r.item.id));

  // After a row is answered it leaves the list, and focus goes to the row that took its place.
  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    const el = list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`) ?? list.current?.querySelector<HTMLElement>('[data-row]');
    el?.focus();
  }, [rows.length]);

  const confirm = async (r: NeedsRow) => {
    const picked = pickOf(r);
    if (picked === undefined || busy) return;
    const at = rows.findIndex((x) => x.item.id === r.item.id);
    focusNext.current = rows[at + 1]?.item.id ?? rows[at - 1]?.item.id ?? '';
    setBusy(true);
    try {
      await c.reclassify(r.item, picked === 'unsure' ? null : picked, '');
      setPicks(({ [r.item.id]: _gone, ...rest }) => rest);
    } catch {
      focusNext.current = null;
    } finally {
      setBusy(false);
    }
  };

  // Accepting a suggestion records the person's yes in their ledger, so it waits like a pick and the row leaves the list; a failure is the notice.
  const acceptThese = async (ids: string[]) => {
    if (busy) return;
    const at = rows.findIndex((x) => x.item.id === ids[0]);
    focusNext.current = rows.find((x, i) => i !== at && !ids.includes(x.item.id) && i > at)?.item.id ?? rows.find((x) => !ids.includes(x.item.id))?.item.id ?? '';
    setBusy(true);
    try {
      await c.accept(ids);
    } catch {
      focusNext.current = null;
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    if (!c.api || asking) return;
    setAsking(true);
    setProblem(null);
    setAsked(null);
    try {
      const items = unsure.slice(0, ASK_AT_MOST).map((r) => r.item);
      const got = await c.api.ask(toilProject.name, items, adapter);
      c.setProposals(got.answers);
      setAsked({ by: got.by, count: got.answers.filter((a) => a.category !== 'unsure').length, warnings: got.warnings, omitted: got.omitted + Math.max(0, unsure.length - ASK_AT_MOST) });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  // A project whose work was never read has nothing to sort, which is not "everything is sorted" (principle 12).
  const read = workRead(ins.items, toilProject.readTargets);
  const partial = read.state === 'partial';
  const ready = agents.filter((a) => a.ready);
  const proposed = [...c.proposals.keys()].filter((id) => rows.some((r) => r.item.id === id));
  const review = () =>
    setCards(
      byConnection(pending.map((p) => p.item)).map((g) => ({ connection: g.connection, work: { items: g.items } })),
    );

  if (read.state === 'unread') {
    return (
      <>
        <div className="view-head">
          <p className="eyebrow">
            <a href={toilProjectHref(toilProject.name)}>{toilProject.name}</a>
          </p>
          <h1 tabIndex={-1} title={plain.title('Classify')}>
            {words('classify.title')}
          </h1>
        </div>
        <section aria-labelledby="needs-head" className="classify__rows" data-classify-unread="">
          <h2 id="needs-head">{words('classify.unread')}</h2>
          {read.failed.map((label) => (
            <p key={label} className="note">
              {label}: work items not read
            </p>
          ))}
          <Empty message={words('classify.unread.body')} action={<TrackerAction toilProject={toilProject.name} sync={sync} />} />
        </section>
      </>
    );
  }

  return (
    <>
      <div className="view-head">
        <p className="eyebrow">
          <a href={toilProjectHref(toilProject.name)}>{toilProject.name}</a>
        </p>
        <h1 tabIndex={-1} title={plain.title('Classify')}>
          {words('classify.title')}
        </h1>
        <p className="lede">
          Items nobody has put in a category yet, and items whose label and rules disagree, read {plainDates(now.slice(0, 10))}. Pick one for each: your answers are saved in your own record, and the tracker changes only when you apply them. <Help topic="classify" />
        </p>
        {ins.schemeNote && (
          <p role="note" className="failure">
            {ins.schemeNote}
          </p>
        )}
      </div>

      <FilterBar period={false} />

      <HowItsDoing agents={agents} adapter={adapter} />

      <section className="classify__bar" aria-label="Ask your AI agent">
        <Button className="btn" onPress={() => void ask()} isDisabled={asking || unsure.length === 0 || ready.length === 0 || !c.api} data-ask-agent="">
          {asking ? 'Asking your AI agent…' : words('classify.ask')}
        </Button>
        {agents.length > 1 && (
          <Select className="classify__adapter" selectedKey={adapter ?? agents.find((a) => a.ready)?.name ?? null} onSelectionChange={(k) => setAdapter(String(k))} aria-label="Which AI agent">
            <Button className="btn btn--small">
              <SelectValue />
            </Button>
            <Popover className="popover">
              <ListBox className="menu">
                {agents.map((a) => (
                  <ListBoxItem key={a.name} id={a.name} className="menu-item" isDisabled={!a.ready} textValue={a.label}>
                    {a.label}
                    {a.problem ? ` (${a.problem})` : ''}
                  </ListBoxItem>
                ))}
              </ListBox>
            </Popover>
          </Select>
        )}
        <p className="note">
          {ready.length === 0
            ? 'No AI agent is set up yet. Choose one under Settings, AI agent. You can sort these by hand.'
            : unsure.length === 0
              ? partial
                ? 'Nothing unsure in what was read to ask about.'
                : 'There is nothing unsure left to ask about.'
              : `It reads ${plural(Math.min(unsure.length, ASK_AT_MOST), 'unsure item')} and suggests a category for each. It can't change anything: you accept or ignore every answer.`}
        </p>
        {asked && (
          <p role="status" data-asked="">
            {asked.by || 'Your AI agent'} suggested a category for {plural(asked.count, 'item')}.{asked.omitted > 0 ? ` ${plural(asked.omitted, 'more item')} did not fit in one question; ask again after these.` : ''}
          </p>
        )}
        {asked?.warnings.map((w) => (
          <p key={w} className="note">
            {w}
          </p>
        ))}
        {problem && (
          <p className="failure" role="alert">
            {problem}
          </p>
        )}
        {proposed.length > 0 && (
          <Button className="btn btn--accent" onPress={() => void acceptThese(proposed)} isDisabled={busy} data-accept-all="">
            Accept all {proposed.length}
          </Button>
        )}
      </section>

      {(pending.length > 0 || cards) && (
        <section className="classify__pending" aria-label="Changes waiting for the tracker" data-pending="">
          <h2>{pending.length === 0 ? 'Nothing is waiting for the tracker' : `${plural(pending.length, 'change')} waiting for the tracker`}</h2>
          {pending.length > 0 ? <p className="note">Decided here, not yet written to the tracker. Nothing is written until you press Apply.</p> : cards && <p className="note">{words('classify.allWritten')}</p>}
          {!cards ? (
            <Button className="btn btn--accent" onPress={review} isDisabled={busy} data-review-apply="">
              Review and apply
            </Button>
          ) : (
            <div className="classify__cards">
              {cards.map((g) => (
                <ApplyCard key={g.connection} connection={g.connection} work={g.work} onClose={() => setCards(null)} />
              ))}
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="needs-head" className="classify__rows">
        <h2 id="needs-head">{rows.length === 0 ? (partial ? 'Nothing in what was read needs an answer' : 'Nothing needs an answer') : `${plural(rows.length, 'item')} ${rows.length === 1 ? 'needs' : 'need'} an answer`}</h2>
        {partial &&
          read.failed.map((label) => (
            <p key={label} className="note" data-classify-partial="">
              {label}: work items not read
            </p>
          ))}
        {rows.length > 0 && <p className="note">Pick a category for each row, then Confirm. On a row, K, F and U pick, and Enter confirms and moves to the next.</p>}
        {rows.length === 0 ? (
          <Empty
            message={allowed ? 'No item matching these filters needs an answer.' : pending.length > 0 ? 'Every item has an answer. The changes above are what is left.' : partial ? 'Nothing in what was read needs an answer.' : 'Everything is sorted. Nothing here needs you.'}
            action={allowed ? <EmptyButton onPress={() => (window.location.hash = window.location.hash.split('?')[0]!)}>Show every item</EmptyButton> : pending.length > 0 ? <EmptyButton onPress={review} disabled={busy}>Review and apply</EmptyButton> : <EmptyLink href={chartsHref(toilProject.name, 'mix')}>See the work mix</EmptyLink>}
          />
        ) : (
          <ul className="sortrows plain" ref={list}>
            {rows.map((r) => (
              <Row key={r.item.id} row={r} follow={followers.get(r.item.id) ?? 0} picked={pickOf(r)} onPick={(v) => setPicks((cur) => ({ ...cur, [r.item.id]: v }))} onConfirm={() => void confirm(r)} onAccept={() => void acceptThese([r.item.id])} busy={busy} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
