/**
 * The chat (#253, #343, #344). An Ask bar sits under the header on every
 * dossier page: one line, its placeholder in the theme's voice, with Analyze
 * beside it. Pressing into it opens the focused view, where the conversation
 * takes the screen and the page steps back behind a dimmed backdrop; Escape
 * or Close puts it away, and the conversation stays for when it opens again.
 * A slim strip keeps the context in sight: the dossier, its sprint, and the
 * agent answering, which a switcher there changes for this chat only.
 *
 * Starter questions are a row of chips before the first question, then a
 * Suggestions menu. Answers stream in as the agent writes them, under a
 * status line that says plainly what it is doing (reading the cache with
 * owi_query, reading live with github issue list, writing) in the theme's
 * words, and how long it took; Stop cancels cleanly and keeps what arrived.
 * Each answer names the agent and model that wrote it, and every question
 * carries the chat so far, so a follow-up continues and a switched agent
 * picks up where the last one left off. Citations link to items, suggested
 * changes are proposal cards, never applied, and a failure says so in the
 * pane. Usage is counted per answer and per chat (#295). The agent reads; it
 * never changes a ticket. Work that names no ticket gets the "Not ticketed
 * yet" banner (#304, ./ticket.tsx). An open-door policy, with the door on a closer.
 */

import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Input, Label, Menu, MenuItem, MenuTrigger, Modal, ModalOverlay, Popover, TextField } from 'react-aria-components';
import { ANALYZE, MAX_HISTORY_ANSWER, MAX_HISTORY_TURNS, type AdapterList, type AdapterOption, type Answer, type HistoryTurn } from '../agent.ts';
import { useData, useDerived } from '../data.ts';
import { useSkins, useTheme, useThemeChoiceContext, useWords } from '../skins.tsx';
import { voiceOn } from '../theme-context.ts';
import { Cited } from './items.tsx';
import { useMediaQuery } from './layout.tsx';
import { ProposalCard } from './proposal.tsx';
import { TicketBanner } from './ticket.tsx';
import { ChatUsage, UsageFooter } from './usage.tsx';
import type { AnswerUsage } from '../model-usage.ts';
import type { ChatSession } from '../fingerprint.ts';
import { StaleNote } from './stale.tsx';

/** A new chat's id: one per dossier's conversation, so the server can add up and cap the chat (#295). */
const newChatId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

interface Turn {
  kind: 'turn';
  id: number;
  prompt: string;
  /** Analyze's pulse check (#343), which is a question about the dossier, never work to ticket (#304). */
  analyze?: boolean;
  answer: Answer | null;
  error: string | null;
  done: boolean;
  /** Stopped by the person, with what had arrived kept. */
  stopped?: boolean;
  /** When it was asked, and how long it took once done. */
  started: number;
  ms?: number;
  /** What a run that failed or was stopped used (#295): counted in the chat as the server counts it. */
  usage?: AnswerUsage;
}
/** The chat switched agent (#344): said in the log, where it happened. */
interface Switch {
  kind: 'switch';
  id: number;
  label: string;
}
/** The chat was renewed (#305): said in the log, where it happened. */
interface Renewed {
  kind: 'renew';
  id: number;
}
type Entry = Turn | Switch | Renewed;

/** How often an open chat asks whether it has gone stale, between its own answers (#305). */
export const SESSION_POLL_MS = 60_000;

const seconds = (ms: number) => String(Math.max(1, Math.round(ms / 1000)));
const textOf = (a: Answer) => a.parts.map((p) => p.text).join('\n\n');
const optionLabel = (o: Pick<AdapterOption, 'label' | 'model'>) => (o.model ? `${o.label} (${o.model})` : o.label);

/** The words of the status line (#343): what the agent is doing now, or how the last answer ended. */
/** Below this width the Ask field is too short to name the dossier, so its placeholder is the short one. */
const NARROW_ASK = '(max-width: 599px)';

/** The Ask field's placeholder: the theme's, naming the dossier, or its short form on a narrow screen. */
function useAskPlaceholder(name: string): string {
  const words = useWords();
  return useMediaQuery(NARROW_ASK) ? words('ask.placeholder.short') : words('ask.placeholder', { name });
}

export function statusLine(t: Turn, words: ReturnType<typeof useWords>, now: number): { text: string; tool: string | null; elapsed: string | null } | null {
  if (t.error && !t.stopped) return null;
  if (t.done) return { text: words(t.stopped ? 'status.stopped' : 'status.done', { seconds: seconds(t.ms ?? 0) }), tool: null, elapsed: null };
  const a = t.answer?.activity;
  const elapsed = `${Math.max(0, Math.floor((now - t.started) / 1000))} s`;
  if (a?.phase === 'tool') return { text: words(a.source === 'live' ? 'status.live' : a.source === 'registry' ? 'status.registry' : 'status.cache'), tool: a.tool ?? null, elapsed };
  if (a?.phase === 'writing' || (t.answer && t.answer.parts.length > 0)) return { text: words('status.writing'), tool: null, elapsed };
  return { text: words('loading.answer'), tool: null, elapsed };
}

/** The chat's state, one per dossier: the bar and the focused view share it, so closing the view loses nothing. */
function useChat() {
  const { agent, dossier } = useData();
  const theme = useTheme();
  const choice = useThemeChoiceContext();
  const style = { theme: theme.name, voice: voiceOn(theme, choice) };
  const [entries, setEntries] = useState<Entry[]>([]);
  const [adapter, setAdapter] = useState<string | null>(null);
  const [adapters, setAdapters] = useState<AdapterList | null>(null);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [renewProblem, setRenewProblem] = useState<string | null>(null);
  const next = useRef(0);
  const chatId = useRef(newChatId());
  const abort = useRef<AbortController | null>(null);
  const turns = entries.filter((e): e is Turn => e.kind === 'turn');
  const busy = turns.some((t) => !t.done);

  useEffect(() => () => abort.current?.abort(), []);

  const update = (id: number, patch: Partial<Turn>) => setEntries((es) => es.map((e) => (e.kind === 'turn' && e.id === id ? { ...e, ...patch } : e)));

  const refreshAdapters = () => {
    if (!agent.adapters) return;
    agent.adapters().then(setAdapters, () => setAdapters(null));
  };

  const ask = async (prompt: string, shown = prompt) => {
    if (busy || !prompt.trim()) return;
    const id = next.current++;
    const chat = { id: chatId.current, turn: turns.length + 1 };
    // The chat so far, so a follow-up continues from the last answer and a switched agent carries over (#344).
    // Only what the prompt uses: the last turns, each answer cut one character past the limit, so the server still marks it cut.
    const history: HistoryTurn[] = turns
      .flatMap((t) => (t.done && !t.error && t.answer?.parts.length ? [{ prompt: t.prompt, answer: textOf(t.answer).slice(0, MAX_HISTORY_ANSWER + 1), by: t.answer.by }] : []))
      .slice(-MAX_HISTORY_TURNS);
    const extra = { ...(adapter ? { adapter } : {}), ...(history.length ? { history } : {}) };
    const controller = new AbortController();
    abort.current = controller;
    const started = Date.now();
    setEntries((es) => [...es, { kind: 'turn', id, prompt: shown, answer: null, error: null, done: false, started, ...(prompt === ANALYZE ? { analyze: true } : {}) }]);
    try {
      let last: Answer | null = null;
      if (agent.stream) {
        for await (const partial of agent.stream(dossier.name, prompt, controller.signal, style, chat, extra)) {
          if (controller.signal.aborted) return;
          last = partial;
          update(id, { answer: partial });
        }
      } else {
        last = await agent.ask(dossier.name, prompt, style, chat, extra);
        update(id, { answer: last });
      }
      if (!controller.signal.aborted) {
        update(id, { done: true, ms: Date.now() - started });
        // The finished answer says whether the chat has gone stale (#305): checked at every turn.
        if (last?.session) setSession(last.session);
      }
    } catch (e: unknown) {
      if (controller.signal.aborted) return;
      const usage = (e as { usage?: AnswerUsage } | null)?.usage;
      update(id, { answer: null, error: `The agent couldn't answer: ${e instanceof Error ? e.message : String(e)}`, done: true, ms: Date.now() - started, ...(usage ? { usage } : {}) });
    }
  };

  /** Stop: the request is cancelled, which stops the run on the server, and what arrived stays. */
  const stop = () => {
    const running = turns.find((t) => !t.done);
    abort.current?.abort();
    if (running) update(running.id, { done: true, stopped: true, ms: Date.now() - running.started, ...(running.answer ? { answer: { ...running.answer, activity: undefined } as Answer } : {}) });
  };

  const switchTo = (name: string | null, label: string) => {
    if (name === adapter) return;
    setAdapter(name);
    setEntries((es) => (es.length ? [...es, { kind: 'switch', id: next.current++, label }] : es));
  };

  /** Asks the server whether this chat has gone stale (#305); a chat that hasn't asked yet has nothing to check. */
  const checkSession = () => {
    if (!agent.session || !turns.length) return;
    agent.session(chatId.current).then(
      (s) => s && setSession(s),
      () => undefined,
    );
  };
  const asked = turns.length > 0;
  useEffect(() => {
    if (!asked || !agent.session) return;
    const t = setInterval(checkSession, SESSION_POLL_MS);
    return () => clearInterval(t);
    // checkSession reads the chat id from a ref, so the interval only needs to start once the chat has asked.
  }, [asked, agent]);

  /**
   * Renew (#305): the server records what the chat starts on now, and the
   * log says so where it happened. Never while it answers; the log above
   * stays, and the next question carries it as a summary, as every question does.
   * Resolves with why it couldn't, or null once it has.
   */
  const renew = async (): Promise<string | null> => {
    if (!agent.renew) return 'This agent keeps no sessions, so there is nothing to renew.';
    if (busy) return 'It is answering a question now, and a renew never interrupts one.';
    setRenewProblem(null);
    try {
      setSession(await agent.renew(chatId.current, dossier.name));
      setEntries((es) => [...es, { kind: 'renew', id: next.current++ }]);
      return null;
    } catch (e) {
      const why = `The chat couldn't be renewed: ${e instanceof Error ? e.message : String(e)}`;
      setRenewProblem(why);
      return why;
    }
  };

  return { entries, turns, busy, ask, stop, adapter, adapters, refreshAdapters, switchTo, session, checkSession, renew, renewProblem };
}

type Chat = ReturnType<typeof useChat>;

const ChatContext = createContext<Chat | null>(null);

/** The dossier's chat, for whatever on its pages needs it: the Ask bar, and Renew all stale in the Agents lane (#305). */
export const useChatScope = (): Chat | null => useContext(ChatContext);

/** Holds the dossier's chat around its pages; the App keys it by dossier, so a conversation lasts across that dossier's views. */
export function ChatScope({ children }: { children: ReactNode }) {
  const chat = useChat();
  return <ChatContext value={chat}>{children}</ChatContext>;
}

/** The Ask bar under the header on every dossier page (#343), and the focused view it opens. */
export function AskBar() {
  const { dossier } = useData();
  const words = useWords();
  const placeholder = useAskPlaceholder(dossier.name);
  const scoped = useChatScope();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  if (!scoped) throw new Error("The Ask bar needs the ChatScope the App puts around a dossier's pages.");
  const chat = scoped;
  const last = chat.turns[chat.turns.length - 1];

  const openView = () => {
    setOpen(true);
    chat.refreshAdapters();
    chat.checkSession();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    openView();
    if (!text.trim()) return;
    const prompt = text;
    setText('');
    void chat.ask(prompt);
  };
  const analyze = () => {
    openView();
    void chat.ask(ANALYZE, 'Analyze');
  };

  return (
    <section className="ask-bar" aria-label={`Ask about ${dossier.name}`}>
      <form className="ask-bar__form" onSubmit={submit}>
        <TextField className="field-text ask-bar__field" value={text} onChange={setText} aria-label="Your question">
          <Input placeholder={placeholder} onClick={openView} data-ask-bar="" />
        </TextField>
        <Button type="submit" className="btn btn--accent">
          Ask
        </Button>
        <Button className="btn" onPress={analyze} isDisabled={chat.busy} data-analyze="">
          Analyze
        </Button>
      </form>
      {chat.session?.stale && !open && <StaleNote stale={chat.session.stale} className="ask-bar__stale" />}
      {last && !open && (
        <p className="ask-bar__resume note">
          {chat.turns.length} {chat.turns.length === 1 ? 'question' : 'questions'} in this chat{!last.done ? `, ${statusLine(last, words, Date.now())?.text ?? ''}` : ''}.{' '}
          <Button className="btn btn--small" onPress={openView} data-ask-resume="">
            Open the conversation
          </Button>
        </p>
      )}
      <ModalOverlay className="ask-overlay" data-backdrop="" isDismissable isOpen={open} onOpenChange={setOpen}>
        <Modal className="ask-modal">
          <Focused chat={chat} text={text} setText={setText} />
        </Modal>
      </ModalOverlay>
    </section>
  );
}

/** The focused view (#343): the context strip, the conversation, the status line, suggestions and the question box. */
function Focused({ chat, text, setText }: { chat: Chat; text: string; setText: (t: string) => void }) {
  const { agent, dossier } = useData();
  const { health: h } = useDerived();
  const { EmptyState, ChatMessage } = useSkins();
  const words = useWords();
  const placeholder = useAskPlaceholder(dossier.name);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const end = useRef<HTMLDivElement>(null);
  const { entries, turns, busy } = chat;
  const last = turns[turns.length - 1];
  const starters = agent.starters(dossier.name);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [entries]);
  // The elapsed seconds tick only while something runs.
  useEffect(() => {
    if (!busy) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const prompt = text;
    setText('');
    void chat.ask(prompt);
  };

  const options = chat.adapters?.options ?? [];
  const current = options.find((o) => o.name === (chat.adapter ?? chat.adapters?.chosen));
  const answering = current ? optionLabel(current) : (agent.label ?? 'the agent chosen in Settings');
  const usages = turns.flatMap((t) => (t.done && (t.answer?.usage ?? t.usage) ? [(t.answer?.usage ?? t.usage)!] : []));
  const status = last ? statusLine(last, words, now) : null;
  const labelOf = (a: Answer) => {
    const o = options.find((x) => x.name === a.adapter);
    if (a.by === 'scripted') return 'a scripted preview, not a model';
    return o ? (a.model ? `${o.label} (${a.model})` : o.label) : a.by;
  };

  return (
    <Dialog className="ask ask-focus" aria-labelledby="ask">
      <div className="ask-strip">
        <div className="ask-strip__text">
          <Heading slot="title" id="ask">
            Ask about {dossier.name}
          </Heading>
          <p className="ask-strip__context note">
            <span>Dossier {dossier.name}</span>
            <span>{h ? `${h.sprint.name}, day ${h.days.gone} of ${h.days.total}` : 'No sprint running'}</span>
            <span>
              Answered by{' '}
              {agent.adapters ? <AgentSwitch label={answering} list={chat.adapters} current={chat.adapter} onPick={chat.switchTo} /> : <strong>{answering}</strong>}
            </span>
          </p>
        </div>
        <AskInfo agentLabel={answering} />
        {chat.session?.stale && !chat.session.stale.restart && agent.renew && (
          <Button className="btn btn--small" onPress={() => void chat.renew()} isDisabled={busy} data-chat-renew="">
            Renew
          </Button>
        )}
        <Button slot="close" className="btn btn--small" data-ask-close="">
          Close
        </Button>
      </div>

      <div className="ask-scroll" data-scroller="" tabIndex={0} role="region" aria-label="The conversation">
        <p className="note">{words('ask.note')}</p>
        {chat.session?.stale && <StaleNote stale={chat.session.stale} />}
        {chat.session?.stale?.restart && <p className="note any-break">{chat.session.stale.restart}</p>}
        {chat.session?.stale && busy && <p className="note">Renew waits for this answer: it never interrupts one.</p>}
        {chat.renewProblem && (
          <p role="alert" className="failure">
            {chat.renewProblem}
          </p>
        )}
        <div className="log" role="log" aria-live="polite" aria-busy={busy} aria-label="Conversation">
          {entries.length === 0 && (agent.notice ? <p className="note agent-notice">{agent.notice}</p> : <EmptyState message={words('ask.welcome', { name: dossier.name })} />)}
          {entries.map((e) =>
            e.kind === 'renew' ? (
              <p key={`r${e.id}`} className="ask-switch note">
                Renewed on today's instructions. The conversation above stays, and the next question carries a summary of it.
              </p>
            ) : e.kind === 'switch' ? (
              <p key={`s${e.id}`} className="ask-switch note">
                Switched to {e.label} for this chat. The next question carries a summary of the conversation so far.
              </p>
            ) : (
              <div key={e.id} className="turn">
                <ChatMessage from="you">
                  <p>
                    <span className="sr-only">You asked: </span>
                    {e.prompt}
                  </p>
                </ChatMessage>
                {e.error ? (
                  <>
                    <p role="alert" className="failure">
                      {e.error}
                    </p>
                    {e.usage && <UsageFooter usage={e.usage} />}
                  </>
                ) : (
                  <ChatMessage from="agent">
                    {e.answer && e.answer.parts.length > 0 ? (
                      <>
                        <h3>{e.answer.prompt}</h3>
                        {e.done && e.answer.warnings && e.answer.warnings.length > 0 && (
                          <div className="answer-checks" aria-label="Checks on this answer">
                            {e.answer.warnings.map((w, i) => (
                              <p key={i} className="failure">
                                {w}
                              </p>
                            ))}
                          </div>
                        )}
                        {e.answer.parts.map((p, i) => (
                          <p key={i}>
                            <Cited text={p.text} />
                          </p>
                        ))}
                        {e.done && (
                          <p className="by">
                            {e.stopped ? 'Stopped before the end. ' : `Cites ${e.answer.citations.length} ${e.answer.citations.length === 1 ? 'item' : 'items'}.${e.answer.unverified && e.answer.unverified.length > 0 ? ` Names ${e.answer.unverified.length} its tools never returned.` : ''} `}
                            Answered by: {labelOf(e.answer)}
                            {e.ms !== undefined ? `, in ${seconds(e.ms)} s` : ''}.{e.answer.carried ? ` It was given a summary of the ${e.answer.carried} earlier ${e.answer.carried === 1 ? 'turn' : 'turns'}.` : ''}
                          </p>
                        )}
                        {e.done && e.answer.usage && <UsageFooter usage={e.answer.usage} />}
                      </>
                    ) : (
                      <p className="note">{e.stopped ? 'Stopped before any answer arrived.' : words('loading.answer')}</p>
                    )}
                    {e.done &&
                      !e.stopped &&
                      e.answer?.proposals
                        .filter((p) => !dismissed.has(p.id))
                        .map((p) => <ProposalCard key={p.id} proposal={p} onDismiss={() => setDismissed((d) => new Set(d).add(p.id))} />)}
                  </ChatMessage>
                )}
              </div>
            ),
          )}
          <TicketBanner prompts={turns.filter((t) => !t.analyze).map((t) => t.prompt)} />
          <div ref={end} />
        </div>
      </div>

      <div className="ask-foot">
        {status && (
          <div className="ask-status">
            <p role="status" className="ask-status__line" data-ask-status="">
              {status.text}
              {status.tool && (
                <>
                  {': '}
                  <code>{status.tool}</code>
                </>
              )}
              {status.elapsed && <span aria-hidden="true" className="ask-status__time"> · {status.elapsed}</span>}
            </p>
            {busy && (
              <Button className="btn btn--small" onPress={chat.stop} data-ask-stop="">
                Stop
              </Button>
            )}
          </div>
        )}
        <ChatUsage usages={usages} />
        {starters.length > 0 &&
          (turns.length === 0 ? (
            <div className="starters" role="group" aria-label="Starter questions">
              {starters.map((s) => (
                <Button key={s.id} className="starter" onPress={() => void chat.ask(s.id, s.label)} isDisabled={busy}>
                  {s.label}
                </Button>
              ))}
            </div>
          ) : (
            <MenuTrigger>
              <Button className="btn btn--small ask-suggest" isDisabled={busy} data-ask-suggestions="">
                Suggestions
              </Button>
              <Popover className="popover menu-popover" placement="top start" offset={6}>
                <Menu className="menu" aria-label="Suggested questions" onAction={(key) => void chat.ask(String(key), starters.find((s) => s.id === key)?.label ?? String(key))}>
                  {starters.map((s) => (
                    <MenuItem key={s.id} id={s.id} className="menu-item">
                      {s.label}
                    </MenuItem>
                  ))}
                </Menu>
              </Popover>
            </MenuTrigger>
          ))}
        <form className="ask-form" onSubmit={submit}>
          <TextField className="field-text" value={text} onChange={setText} isDisabled={busy} autoFocus>
            <Label>Your question</Label>
            <Input placeholder={placeholder} />
          </TextField>
          <Button type="submit" className="btn btn--accent" isDisabled={busy || !text.trim()}>
            Ask
          </Button>
          <Button className="btn" onPress={() => void chat.ask(ANALYZE, 'Analyze')} isDisabled={busy}>
            Analyze
          </Button>
        </form>
      </div>
    </Dialog>
  );
}

/**
 * The agent switcher in the chat's strip (#344): every adapter, its model,
 * and whether it can answer. One that can't says why, with Install or Fix
 * pointing at Settings, Agent; it is never left out. A choice here holds for
 * this chat only, from its next question; the default stays in Settings.
 */
function AgentSwitch({ label, list, current, onPick }: { label: string; list: AdapterList | null; current: string | null; onPick: (name: string | null, label: string) => void }) {
  return (
    <DialogTrigger>
      <Button className="btn btn--small agent-switch" data-agent-switch="">
        {label}
        <span aria-hidden="true"> ▾</span>
        <span className="sr-only">, change the agent for this chat</span>
      </Button>
      <Popover className="popover agent-switch__popover" placement="bottom start" offset={6}>
        <Dialog className="agent-switch__dialog" aria-labelledby="agent-switch-title">
          {({ close }) => (
            <>
              <Heading slot="title" id="agent-switch-title" className="ask-info__title">
                Agent for this chat
              </Heading>
              {!list ? (
                <p className="note">Reading the agents…</p>
              ) : (
                <ul className="agent-picks">
                  {list.options.map((o) => {
                    const chosen = (current ?? list.chosen) === o.name;
                    return (
                      <li key={o.name} className="agent-pick">
                        <Button
                          className="agent-pick__button"
                          isDisabled={!o.ready}
                          aria-current={chosen ? true : undefined}
                          onPress={() => {
                            onPick(o.name === list.chosen ? null : o.name, optionLabel(o));
                            close();
                          }}
                        >
                          <strong>{o.label}</strong>
                          <span className="note">
                            {o.name === 'scripted' ? 'Canned answers, no model' : o.model ? `Model ${o.model}` : "Its CLI's default model"}
                            {o.name === list.chosen && o.name !== 'scripted' ? ', the default from Settings' : ''}
                          </span>
                          <span className={o.ready ? 'agent-pick__ready' : 'agent-missing'}>{chosen ? 'Answering' : o.ready ? 'Ready' : 'Unavailable'}</span>
                        </Button>
                        {!o.ready && (
                          <p className="note agent-pick__why">
                            {o.problem}
                            {o.fix ? ` ${o.fix}` : ''}
                            {o.action && (
                              <>
                                {' '}
                                <a href="#/settings/agent" onClick={close}>
                                  {o.action === 'install' ? `Install ${o.label}` : `Fix ${o.label}`}
                                </a>
                              </>
                            )}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="note">Switching holds for this chat, from its next question. The default stays under Settings, Agent.</p>
            </>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

/**
 * The (i) in the chat's strip (#283): a button that opens a short popover,
 * never a hover-only tooltip, so a keyboard, a touch screen and a screen
 * reader reach the same words. React Aria's Dialog keeps focus inside while
 * it's open, and Escape or a click outside closes it.
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
      <Popover className="popover ask-info" placement="bottom end" offset={6}>
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
