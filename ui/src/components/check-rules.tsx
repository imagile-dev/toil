/**
 * "Check with AI agent" (#657): the one press that asks the person's AI agent
 * to judge ticket rules, on one item (its page) or the open items a list shows
 * (Tickets). It never runs on a page load. It carries the theme's agent mark,
 * like every control that starts an agent, and says in its tooltip what it does
 * and what it reads (principle 11); afterwards one line says what came of it,
 * and a failure stays on screen in the agent's words (principle 4). Items whose
 * every verdict still holds are left alone, so pressing twice costs nothing the
 * second time, which is the only meeting that has ever been free to repeat.
 */

import { useState } from 'react';
import { Button, Tooltip, TooltipTrigger } from 'react-aria-components';
import { useData } from '../data.ts';
import { rulesOf, unjudged, type JudgeResult } from '../rules.ts';
import { AgentMark } from './agent-mark.tsx';
import { AGENT_SETTINGS_HREF } from '../format.ts';
import { NavButton } from './nav-button.tsx';

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a press came back with, as a compact figure: "Judged 1 · 5 unchanged · 2 left". The sentence is `judgedText`, in its title. */
export function judgedFigure(r: Pick<JudgeResult, 'judged' | 'current' | 'left'>): string {
  const parts = [`Judged ${r.judged}`];
  if (r.current) parts.push(`${r.current} unchanged`);
  if (r.left) parts.push(`${r.left} left`);
  return parts.join(' · ');
}

/** What a press came back with, in a sentence. */
export function judgedText(r: Pick<JudgeResult, 'judged' | 'current' | 'left' | 'by'>): string {
  const parts = [r.judged ? `${r.by ?? 'Your AI agent'} judged ${count(r.judged, 'item')}.` : 'Nothing new to judge.'];
  if (r.current) parts.push(`${count(r.current, 'item')} already judged on ${r.current === 1 ? 'its' : 'their'} current text.`);
  if (r.left) parts.push(`${count(r.left, 'item')} not judged yet: press again.`);
  return parts.join(' ');
}

/**
 * The press for these items. `scope` words the tooltip: one item, or the items listed. Hidden where nothing can judge
 * (a view rendered on its own) or the toil project names no rules.
 */
export function CheckRulesButton({ items, scope, size = 'sm' }: { items: readonly string[]; scope: 'item' | 'list'; size?: 'sm' | 'md' }) {
  const { rules } = useData();
  const [said, setSaid] = useState<{ ok: boolean; text: string; title?: string; notes: string[] } | null>(null);
  if (!rules?.judge || rules.reading.state !== 'read') return null;
  const all = rulesOf(rules.reading);
  if (all.length === 0) return null;
  const agent = rules.view?.agent ?? null;
  const busy = Boolean(rules.judging) || Boolean(rules.view?.judging);
  const waiting = items.filter((id) => unjudged(rules.reading, id) > 0).length;
  const who = agent?.label ?? 'your AI agent';
  const what = scope === 'item' ? 'this item' : `the ${count(items.length, 'open item')} listed`;
  const tip = `Asks ${who} to judge ${what} against the ${count(all.length, 'ticket rule')} this Toil project names: met, missed, unsure or doesn't apply, each with a reason and a quote from the item. It reads each rule's text and each item's title, type, labels, description, acceptance criteria and repro steps as last synced, and changes nothing. Items already judged on their current text are skipped.`;
  const disabled = busy || items.length === 0 || !agent || agent.problem !== null;
  const press = async () => {
    setSaid(null);
    try {
      const r = await rules.judge!([...items]);
      setSaid({ ok: true, text: judgedFigure(r), title: judgedText(r), notes: r.notes });
    } catch (e) {
      setSaid({ ok: false, text: e instanceof Error ? e.message : String(e), notes: [] });
    }
  };
  return (
    <span className="check-rules" data-check-rules={scope}>
      <TooltipTrigger delay={300} closeDelay={150}>
        <Button className={size === 'sm' ? 'btn btn--sm' : 'btn'} onPress={press} isDisabled={disabled} data-check-rules-button="">
          <AgentMark />
          {busy ? 'Checking…' : 'Check with AI agent'}
        </Button>
        <Tooltip className="help-tooltip" offset={6}>
          {tip}
        </Tooltip>
      </TooltipTrigger>
      <span className={said && !said.ok ? 'failure' : 'note'} role="status" data-check-rules-status="" title={!busy ? said?.title : undefined}>
        {busy
          ? `${who} is judging ${scope === 'item' ? 'this item' : count(rules.judging?.items.length ?? waiting, 'item')}…`
          : said
            ? said.text
            : !agent
              ? 'No AI agent is set up yet.'
              : agent.problem
                ? agent.problem
                : waiting
                  ? `${count(waiting, 'item')} not judged yet.`
                  : ''}
      </span>
      {!busy && !said && (!agent || agent.problem) && (
        <NavButton href={AGENT_SETTINGS_HREF} size="sm" data-choose-agent="">
          Choose an AI agent
        </NavButton>
      )}
      {said?.notes.map((n) => (
        <span key={n} className="note check-rules__note" role="note">
          {n}
        </span>
      ))}
    </span>
  );
}
