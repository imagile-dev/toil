/**
 * The readiness gate's pieces (#307): the verdict chip, the five rows and the
 * ticket rules' rows (#657), why an item isn't ready, and the item page's
 * panel, where "Check with AI agent" asks the person's agent to judge the
 * rules, and a rule it judged missed offers "Fix with AI agent" (or a standard
 * with several misses offers "Fix all"). A rule's row always says it is the
 * agent's reading, with which agent and when (principle 4). The item page and the Command Center
 * both draw from here, over src/model/readiness.ts, so a verdict reads the
 * same wherever it shows. A rubber stamp, but one that says which box it
 * stamped and why.
 */

import { useState, type ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { useData } from '../data.ts';
import { dateTime } from '../format.ts';
import { usePlain } from '../plain-words.ts';
import { liveWorkflow, readiness, VERDICT_LABEL, VERDICT_PLAIN, withRules, workflowRead, type LiveWorkflow, type Readiness, type Row, type Verdict } from '../model/readiness.ts';
import { FixRuleButton, type RuleToFix } from '../assign/views.tsx';
import { JUDGEMENT_WORD, noteTag } from '../rules.ts';
import { CheckRulesButton } from './check-rules.tsx';
import { CALL_OPTIONS, type WorkItem } from '../toil.ts';
import { Help, InfoTip } from './help.tsx';
import { SummaryChevron, DisclosureBody } from './disclosure.tsx';
import { Cited } from './items.tsx';
import { SourceTip } from './bits.tsx';
import { Card } from './layout.tsx';
import { CheckIcon, CloseIcon, WarningIcon } from './icons.tsx';
import '../views/readiness.css';

// A rule nobody judged is a dash, never a tick: unknown is not a pass (principle 12). Unsure is a question, and doesn't apply a plain circle.
const MARK: Record<Row['state'], ReactNode> = { pass: <CheckIcon size={14} />, thin: <WarningIcon size={14} />, fail: <CloseIcon size={14} />, skipped: '–', unsure: '?', na: '○' };
const STATE_WORD: Record<Row['state'], string> = { pass: 'Passes', thin: 'Thin', fail: 'Fails', skipped: 'Not checked', unsure: 'Unsure', na: "Doesn't apply" };
// A ticket rule says the agent's own word (met, missed, unsure, doesn't apply), or "not judged yet"; its state underneath decides the verdict.
const RULE_WORD: Record<Row['state'], string> = { pass: JUDGEMENT_WORD.met, thin: JUDGEMENT_WORD.missed, fail: 'Fails', skipped: 'Not judged yet', unsure: JUDGEMENT_WORD.unsure, na: JUDGEMENT_WORD.na };

// Rules not read yet is unknown, not a pass or a miss, so its mark is the dash (principle 12).
const VERDICT_MARK: Record<Verdict, ReactNode> = { ready: <CheckIcon size={14} />, thin: <WarningIcon size={14} />, blocked: <CloseIcon size={14} />, unread: '–' };

/** The verdict as a chip: a mark and a word, so it reads the same in a theme whose colours don't tell the three apart. */
export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const plain = usePlain();
  return (
    <span className={`verdict verdict--${verdict}`} title={plain.on && verdict === 'thin' ? plain.title('Thin') : undefined}>
      <span aria-hidden="true">{VERDICT_MARK[verdict]}</span> {(plain.on ? VERDICT_PLAIN : VERDICT_LABEL)[verdict]}
    </span>
  );
}

/** One row: its state in words as well as a mark, its reason, and where it came from. */
function RowLine({ r, blockedAbove = false }: { r: Row; blockedAbove?: boolean }) {
  // The item page names what blocks it under the title (#657), so its blockers row points there rather than naming it again.
  const reason = blockedAbove && r.check === 'blockers' && r.state === 'fail' ? 'what blocks it, named at the top, isn\u2019t done.' : plainReason(r.reason);
  return (
    <li className={`readiness-row readiness-row--${r.state}`}>
      <span className="readiness-mark" aria-hidden="true">
        {MARK[r.state]}
      </span>
      <span>
        <strong>{r.label}</strong> <span className="readiness-state">{STATE_WORD[r.state]}</span>: <Cited text={reason} /> <SourceTip source={r.source} />
      </span>
    </li>
  );
}

/** The sentence behind a "doesn't apply" with no evidence, inside its row's details. */
const NO_EVIDENCE = "The AI agent said this rule doesn't apply, but gave no evidence for it (a quote from the item, or its type or a label), so it counts as not known for readiness.";

/**
 * A ticket rule's row: the agent's own word and reason, labelled as its
 * reading with which agent and when (principle 4, never drawn like a
 * deterministic result), a short tag when Toil UI changed or discounted what it
 * said, and one press in the quote it rested on, the full sentence behind the
 * tag and the rule set it came from. Fix with AI agent sits at the row's end
 * when it was judged missed and its standard has no "Fix all". A rule not
 * judged yet is a dash, "Not judged yet".
 */
function RuleRowLine({ r, action }: { r: Row; action?: ReactNode }) {
  // The one row for rules not read (or failed to read) says so as its state; a rule not judged has no reason to give.
  const label = r.check === 'rules' || !r.judged ? null : plainReason(r.reason);
  const tag = r.judged ? noteTag(r.judged) : null;
  const note = r.judged ? (r.judged.verdict === 'na' && !r.judged.quote ? NO_EVIDENCE : r.judged.note) : null;
  const word = r.check === 'rules' ? r.reason.replace(/\.$/, '') : r.judged ? JUDGEMENT_WORD[r.judged.verdict] : RULE_WORD[r.state];
  return (
    <li className={`readiness-row readiness-row--rule readiness-row--${r.state}`} data-rule-state={r.judged?.verdict ?? (r.check === 'rules' ? 'unread' : 'unjudged')}>
      <span className="readiness-mark" aria-hidden="true">
        {MARK[r.state]}
      </span>
      <details className="readiness-row__more">
        <summary>
          <SummaryChevron />
          <span>
            <strong>{r.label}</strong> <span className="readiness-state">{word}</span>
            {label && (
              <>
                : <Cited text={label} />
              </>
            )}
            {r.judged && (
              <span className="note readiness-row__by" data-judged-by="">
                {' '}
                ({r.judged.by}'s reading, {dateTime(r.judged.at)})
              </span>
            )}
            {tag && (
              <>
                {' '}
                <span className="rule-badge readiness-row__tag" data-rule-tag="">
                  {tag}
                </span>
              </>
            )}
          </span>
        </summary>
        {r.judged?.quote && (
          <blockquote className="readiness-row__quote" data-rule-quote="">
            “{r.judged.quote}”
          </blockquote>
        )}
        {note && (
          <p className="note readiness-row__note" role="note" data-rule-note="">
            {note}
          </p>
        )}
        {r.rule && <p className="field">From {r.rule.standard}</p>}
      </details>
      {action && <span className="readiness-row__action">{action}</span>}
    </li>
  );
}

/** A reason as a person reads it: a Jira custom field's id (`customfield_10500`) is the tracker's internal name, so it reads "a custom field" (#657). */
const plainReason = (text: string) => text.replace(/\bcustomfield_\d+\b/g, 'a custom field');

const isRuleRow = (r: Row) => r.check === 'rules' || r.check.startsWith('rule:');

/** The rule rows by standard, in the check's order: one group a standard, each with the rows that are its rules. */
function byStandard(rows: Row[]): Array<{ standard: string; rows: Row[] }> {
  const groups: Array<{ standard: string; rows: Row[] }> = [];
  for (const r of rows) {
    const standard = r.rule?.standard ?? '';
    const last = groups.at(-1);
    if (last && last.standard === standard) last.rows.push(r);
    else groups.push({ standard, rows: [r] });
  }
  return groups;
}

/**
 * The five rows, then the ticket rules' rows under their own heading, set in
 * and grouped by standard. With `item`, a rule the item misses offers "Fix with
 * AI agent" on its row; where a standard has more than one miss, its group
 * offers one "Fix all N with AI agent" instead, which asks for one rewrite that
 * meets them all, rather than three buttons that would each rewrite the same
 * description.
 */
export function ReadinessRows({ readiness, item, ruleText, blockedAbove = false }: { readiness: Readiness; item?: Pick<WorkItem, 'id' | 'title' | 'source'>; ruleText?: (standard: string, rule: string) => string | null; blockedAbove?: boolean }) {
  const fixed = readiness.rows.filter((r) => !isRuleRow(r));
  const rules = readiness.rows.filter(isRuleRow);
  const toFix = (r: Row): RuleToFix => ({ ...r.rule!, name: r.label, text: ruleText?.(r.rule!.standard, r.rule!.rule) ?? null, reason: r.reason });
  const missedRule = (r: Row) => Boolean(r.rule && r.judged?.verdict === 'missed');
  const settled = (r: Row) => r.state === 'pass' || r.state === 'na';
  const lead = rules.filter((r) => !settled(r));
  const rest = rules.filter(settled);
  return (
    <>
      {/* What fails or is thin stays open; what passes folds to one line, "4 checks pass", opened on a press (#657). */}
      {fixed.some((r) => r.state !== 'pass') && (
        <ul className="rows readiness-rows">
          {fixed
            .filter((r) => r.state !== 'pass')
            .map((r) => (
              <RowLine key={r.check} r={r} blockedAbove={blockedAbove} />
            ))}
        </ul>
      )}
      <Passing rows={fixed.filter((r) => r.state === 'pass')} />
      {rules.length > 0 && (
        <section className="readiness-rules-group" aria-labelledby="readiness-rules-head">
          <h3 className="readiness-subhead" id="readiness-rules-head">
            Ticket rules <Help topic="ticket-rules" />
          </h3>
          {item && (
            <p className="readiness-rules__check">
              <CheckRulesButton items={[item.id]} scope="item" />
            </p>
          )}
          <div data-rule-rows="">
            {byStandard(lead).map((g) => {
              const missed = item ? g.rows.filter(missedRule) : [];
              const all = missed.length > 1;
              return (
                <div key={g.standard || g.rows[0]!.check} className="readiness-standard" data-rule-group={g.standard || undefined}>
                  {all && (
                    <p className="readiness-standard__fix">
                      <span className="field">{missed.length === 1 ? '1 rule missed.' : `${missed.length} rules missed.`}</span>
                      <FixRuleButton item={item!} rules={missed.map(toFix)} />
                    </p>
                  )}
                  <ul className="rows readiness-rows">
                    {g.rows.map((r) => (
                      <RuleRowLine key={r.check} r={r} {...(item && !all && missedRule(r) ? { action: <FixRuleButton item={item} rules={[toFix(r)]} /> } : {})} />
                    ))}
                  </ul>
                </div>
              );
            })}
            {/* Met and doesn't apply (with evidence) fold to one line, as the checks that pass do: what needs a person leads (#657). */}
            {rest.length > 0 && (
              <details className="readiness-passing" data-rules-folded="">
                <summary className="btn btn--quiet btn--sm">
                  <SummaryChevron />
                  {foldedLine(rest)}
                </summary>
                <DisclosureBody>
                  <ul className="rows readiness-rows">
                    {rest.map((r) => (
                      <RuleRowLine key={r.check} r={r} />
                    ))}
                  </ul>
                </DisclosureBody>
              </details>
            )}
          </div>
        </section>
      )}
    </>
  );
}

/** The folded rule rows' line: "2 rules met · 3 don't apply". */
function foldedLine(rows: Row[]): string {
  const met = rows.filter((r) => r.state === 'pass').length;
  const na = rows.length - met;
  const parts = [met ? `${met} ${met === 1 ? 'rule' : 'rules'} met` : '', na ? `${na} ${na === 1 ? "rule doesn't" : "rules don't"} apply` : ''].filter(Boolean);
  return parts.join(' · ');
}

/** The checks that pass, folded behind one line that counts them. */
function Passing({ rows }: { rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <details className="readiness-passing" data-passing="">
      <summary className="btn btn--quiet btn--sm">
        <SummaryChevron />
        {rows.length === 1 ? '1 check passes' : `${rows.length} checks pass`}
      </summary>
      <DisclosureBody>
        <ul className="rows readiness-rows">
          {rows.map((r) => (
            <RowLine key={r.check} r={r} />
          ))}
        </ul>
      </DisclosureBody>
    </details>
  );
}

/**
 * Why an item isn't ready, in one line: the rows that don't pass, worst first.
 * `first` brings the rows it picks to the top, so a list filtered to a ticket
 * rule leads with that rule's line.
 */
export function WhyNot({ readiness, first }: { readiness: Readiness; first?: (r: Row) => boolean }) {
  if (!readiness.why.length) return <span className="field">Every check passes.</span>;
  const rows = first ? [...readiness.why.filter(first), ...readiness.why.filter((r) => !first(r))] : readiness.why;
  return (
    <ul className="why-not">
      {rows.map((r) => (
        <li key={r.check}>
          <strong>{r.label}:</strong> {r.judged && <span className="readiness-state">{JUDGEMENT_WORD[r.judged.verdict]}. </span>}
          <Cited text={plainReason(r.reason)} />
          {r.judged && <span className="note"> ({r.judged.by}'s reading)</span>}
        </li>
      ))}
    </ul>
  );
}

/** What the verdict means for starting the item, in the words the item page shows under it. */
const MEANING: Record<Verdict, string> = {
  ready: 'Every check passes: an agent can start on it.',
  thin: "Something is missing. A person can still decide to start it on its own, but it won't be started automatically.",
  blocked: "It can't be worked on as it is, so it is never started.",
  unread: "Nothing fails, but an AI agent hasn't judged one of your team's ticket rules on it yet, or was unsure, so it isn't known to be ready and isn't started.",
};

/**
 * The item page's readiness panel: the verdict, its rows, and the one live
 * read that can settle the done-state check, made only when a person presses
 * for it. Nothing here asks a model.
 */
export function ReadinessPanel({ item, blockedAbove = false }: { item: WorkItem; blockedAbove?: boolean }) {
  const { toilProject, byId, execute, rules } = useData();
  const settings = withRules(toilProject.readiness, rules?.reading);
  const ruleText = (standard: string, rule: string) => rules?.reading.standards.find((s) => s.name === standard)?.rules.find((x) => x.id === rule)?.text ?? null;
  const [live, setLive] = useState<{ result: LiveWorkflow; at: string } | null>(null);
  const [reading, setReading] = useState(false);
  const r = readiness({ item, settings, byId, ...(live ? { live: live.result } : {}) });
  const read = item.statusCategory === 'DONE' ? null : workflowRead(item);
  const check = async () => {
    if (!execute || !read) return;
    setReading(true);
    const env = await execute(read.command, { toilProject: toilProject.name, ...read.input }, CALL_OPTIONS);
    setLive({ result: liveWorkflow(item, read.command, env.ok ? env.data : null, env.ok ? undefined : `${env.error.message}${env.error.fix ? ` ${env.error.fix}` : ''}`), at: new Date().toISOString() });
    setReading(false);
  };
  return (
    <Card as="section" className="panel readiness-panel" aria-labelledby="readiness">
      <h2>
        <span id="readiness">Ready for an agent?</span> <Help topic="readiness-checks" note={`The five checks are worked out by code from the last sync${live ? ' and one live read' : ''}, with no AI; the ticket rules are your AI agent's reading, on your press.${read && execute ? ' Check the workflow live asks the tracker once, without changing anything, to settle the done state.' : ''} Where each check looks, and how to change it, is in Read more.`} />
      </h2>
      <p className="readiness-verdict">
        {/* What the verdict means for starting it is an explanation, so it sits in the chip's (i), not on the page (#657). */}
        <VerdictChip verdict={r.verdict} />{' '}
        <InfoTip label={VERDICT_PLAIN[r.verdict]} tip={MEANING[r.verdict]} triggerProps={{ 'data-verdict-help': r.verdict }}>
          <p>{MEANING[r.verdict]}</p>
        </InfoTip>
      </p>
      <ReadinessRows readiness={r} item={item} ruleText={ruleText} blockedAbove={blockedAbove} />
      {read && execute && (
        <p className="readiness-live">
          <Button className="btn btn--sm" onPress={check} isDisabled={reading}>
            {reading ? 'Reading the workflow…' : live ? 'Read the workflow again' : 'Check the workflow live'}
          </Button>{' '}
          {/* What the live read was is the result's source, so it stays in view once there is one (principle 4); before then the (i) explains the button. */}
          <span className="field" aria-live="polite">
            {live ? `Read live ${dateTime(live.at)} with toil ${read.command}.` : ''}
          </span>
        </p>
      )}
      {settings.notes.map((n, i) => (
        <p key={i} role="note" className="failure">
          {n}
        </p>
      ))}
    </Card>
  );
}
