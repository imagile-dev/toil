/**
 * The chat (#253): the agent docked beside the dashboard on a wide screen and
 * a sheet over the bottom of a narrow one, always one tap away. Starter
 * questions come from the agent for this dossier, one of them about what the
 * insights rank first; anything else can be typed. Answers stream in as the
 * agent writes them, their citations link to items, and the changes they
 * suggest are proposal cards to review, never applied. An agent that fails
 * says so in the pane, never only in the console. It reads; it never changes
 * a ticket. Beside the starter questions, an (i) says whose voice the answers
 * are in, who answers, and where to change both (#283). Each answer ends
 * with what the SDK reported it used, and the chat's heading carries the
 * running total and the context meter (#295); the chat's id goes with every
 * question, so the server can hold the chat to its cap. Work that names no
 * ticket gets the "Not ticketed yet" banner (#304, ./ticket.tsx).
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Input, Label, Popover, TextField } from 'react-aria-components';
import type { Answer } from '../agent.ts';
import { useData } from '../data.ts';
import { useSkins, useTheme, useThemeChoiceContext, useWords } from '../skins.tsx';
import { voiceOn } from '../theme-context.ts';
import { useMediaQuery } from './layout.tsx';
import { Cited } from './items.tsx';
import { ProposalCard } from './proposal.tsx';
import { TicketBanner } from './ticket.tsx';
import { ChatUsage, UsageFooter } from './usage.tsx';
import type { AnswerUsage } from '../model-usage.ts';

/** A new chat's id: one per pane, so the server can add up and cap the chat (#295). */
const newChatId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

interface Turn {
  id: number;
  prompt: string;
  answer: Answer | null;
  error: string | null;
  done: boolean;
  /** What a run that failed or was stopped used (#295): counted in the chat as the server counts it. */
  usage?: AnswerUsage;
}

export function Ask() {
  const { agent, dossier } = useData();
  const { EmptyState, ChatMessage } = useSkins();
  const words = useWords();
  const theme = useTheme();
  const choice = useThemeChoiceContext();
  const style = { theme: theme.name, voice: voiceOn(theme, choice) };
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const narrow = useMediaQuery('(max-width: 1000px)');
  const next = useRef(0);
  const chatId = useRef(newChatId());
  const abort = useRef<AbortController | null>(null);
  const busy = turns.some((t) => !t.done);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [turns]);

  const update = (id: number, patch: Partial<Turn>) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const ask = async (prompt: string, shown = prompt) => {
    if (busy || !prompt.trim()) return;
    const id = next.current++;
    const chat = { id: chatId.current, turn: id + 1 };
    const controller = new AbortController();
    abort.current = controller;
    setTurns((ts) => [...ts, { id, prompt: shown, answer: null, error: null, done: false }]);
    try {
      if (agent.stream) {
        for await (const partial of agent.stream(dossier.name, prompt, controller.signal, style, chat)) {
          if (controller.signal.aborted) return;
          update(id, { answer: partial });
        }
      } else {
        update(id, { answer: await agent.ask(dossier.name, prompt, style, chat) });
      }
      update(id, { done: true });
    } catch (e: unknown) {
      const usage = (e as { usage?: AnswerUsage } | null)?.usage;
      update(id, { answer: null, error: `The agent couldn't answer: ${e instanceof Error ? e.message : String(e)}`, done: true, ...(usage ? { usage } : {}) });
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const prompt = text;
    setText('');
    void ask(prompt);
  };

  const showBody = !narrow || open;
  const usages = turns.flatMap((t) => (t.done && (t.answer?.usage ?? t.usage) ? [(t.answer?.usage ?? t.usage)!] : []));
  return (
    <aside className={`ask${narrow ? ' ask--sheet' : ''}${narrow && open ? ' ask--open' : ''}`} aria-labelledby="ask">
      <div className="ask-head">
        <h2 id="ask">Ask about {dossier.name}</h2>
        {narrow && (
          <Button className="btn btn--small" aria-expanded={open} aria-controls="ask-body" onPress={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Open'}
          </Button>
        )}
      </div>
      <div id="ask-body" className="ask-body" hidden={!showBody}>
        <p className="note">{words('ask.note')}</p>
        <ChatUsage usages={usages} />
        <div className="log" role="log" aria-live="polite" aria-busy={busy} aria-label="Conversation">
          {turns.length === 0 && (agent.notice ? <p className="note agent-notice">{agent.notice}</p> : <EmptyState message={words('empty.ask')} />)}
          {turns.map((t) => (
            <div key={t.id} className="turn">
              <ChatMessage from="you">
                <p>
                  <span className="sr-only">You asked: </span>
                  {t.prompt}
                </p>
              </ChatMessage>
              {t.error ? (
                <>
                  <p role="alert" className="failure">
                    {t.error}
                  </p>
                  {t.usage && <UsageFooter usage={t.usage} />}
                </>
              ) : (
                <ChatMessage from="agent">
                  {t.answer ? (
                    <>
                      <h3>{t.answer.prompt}</h3>
                      {t.done && t.answer.warnings && t.answer.warnings.length > 0 && (
                        <div className="answer-checks" aria-label="Checks on this answer">
                          {t.answer.warnings.map((w, i) => (
                            <p key={i} className="failure">
                              {w}
                            </p>
                          ))}
                        </div>
                      )}
                      {t.answer.parts.map((p, i) => (
                        <p key={i}>
                          <Cited text={p.text} />
                        </p>
                      ))}
                      {t.done && (
                        <p className="by">
                          Cites {t.answer.citations.length} {t.answer.citations.length === 1 ? 'item' : 'items'}.{t.answer.unverified && t.answer.unverified.length > 0 ? ` Names ${t.answer.unverified.length} its tools never returned.` : ''} Answered by: {t.answer.by === 'scripted' ? 'a scripted preview, not a model' : t.answer.by}.
                        </p>
                      )}
                      {t.done && t.answer.usage && <UsageFooter usage={t.answer.usage} />}
                    </>
                  ) : (
                    <p className="note">{words('loading.answer')}</p>
                  )}
                  {t.done &&
                    t.answer?.proposals
                      .filter((p) => !dismissed.has(p.id))
                      .map((p) => <ProposalCard key={p.id} proposal={p} onDismiss={() => setDismissed((d) => new Set(d).add(p.id))} />)}
                </ChatMessage>
              )}
            </div>
          ))}
          <TicketBanner prompts={turns.map((t) => t.prompt)} />
          <div ref={end} />
        </div>
        <div className="starters-head">
          <p className="note">Questions</p>
          <AskInfo agentLabel={agent.label} />
        </div>
        <div className="starters" role="group" aria-label="Starter questions">
          {agent.starters(dossier.name).map((s) => (
            <Button key={s.id} className="starter" onPress={() => ask(s.id, s.label)} isDisabled={busy}>
              {s.label}
            </Button>
          ))}
        </div>
        <form className="ask-form" onSubmit={submit}>
          <TextField className="field-text" value={text} onChange={setText} isDisabled={busy}>
            <Label>Your question</Label>
            <Input placeholder={`Ask about ${dossier.name}`} />
          </TextField>
          <Button type="submit" className="btn btn--accent" isDisabled={busy || !text.trim()}>
            Ask
          </Button>
        </form>
      </div>
    </aside>
  );
}

/**
 * The (i) beside the starter questions (#283): a button that opens a short
 * popover, never a hover-only tooltip, so a keyboard, a touch screen and a
 * screen reader reach the same words. React Aria's Dialog keeps focus inside
 * while it's open, and Escape or a click outside closes it.
 */
export function AskInfo({ agentLabel }: { agentLabel: string | undefined }) {
  const theme = useTheme();
  const choice = useThemeChoiceContext();
  const voiced = voiceOn(theme, choice);
  const voice = voiced
    ? `Answers are written in ${theme.label}'s voice, or in your own custom voice if you saved one. A voice changes their phrasing only: citations, figures and proposals stay exact.`
    : theme.voice
      ? `Themed agent voice is off, so answers are in plain wording, whatever the theme.`
      : `${theme.label} has no voice of its own, so answers are in plain wording.`;
  return (
    <DialogTrigger>
      <Button className="btn info-button" data-ask-info="">
        <span aria-hidden="true" className="info-button__mark">
          i
        </span>
        <span className="sr-only">About these answers</span>
      </Button>
      <Popover className="popover ask-info" placement="top end" offset={6}>
        <Dialog className="ask-info__dialog" aria-labelledby="ask-info-title">
          <Heading slot="title" id="ask-info-title" className="ask-info__title">
            About these answers
          </Heading>
          <p>{voice}</p>
          <p>Answered by {agentLabel ?? 'the agent chosen in Settings'}.</p>
          <p>The agent only reads: its tools can't change a ticket, and anything it suggests comes back as a proposal for you to apply.</p>
          <p>
            Change the voice under <a href="#/settings/toil">Settings, General</a>, and add your own instructions or voice under <a href="#/settings/agent">Settings, Agent</a>.
          </p>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
