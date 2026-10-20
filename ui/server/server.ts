/**
 * The local server (#206, Local first): Node's own `node:http`, no framework,
 * so the package's only runtime dependency stays toil. It serves the built
 * SPA and a small JSON API under the base path, on loopback, behind a lock:
 *
 * - **The launch token.** Each start makes a random token and prints one URL
 *   that carries it, as Jupyter does. The page trades it (`POST api/session`)
 *   for a session id it keeps in memory and sends as `X-Toil-UI-Session` on
 *   every API call; the API answers nothing without one. No cookie is ever
 *   set: browsers send cookies to every port on a host, so one would reach any
 *   other server on 127.0.0.1. The static files hold no data and need no
 *   session. A reload forgets the id, so it takes the launch URL again.
 * - **The Host header.** Only the exact `127.0.0.1:<port>` (or `[::1]:<port>`)
 *   the server printed is answered, so a page using DNS rebinding to reach the
 *   port is refused before anything else is read.
 * - **No CORS.** No `Access-Control-*` header is ever sent. Every POST also
 *   needs the page's own `Origin`, a JSON body, and the session's CSRF token in
 *   `X-Toil-UI-CSRF`, so another page can't make one even blind.
 *
 * Every request becomes a `RequestContext` with its viewer before a Store or
 * Agent sees it. Reads are only the commands the views make (`READ_COMMANDS`),
 * always read-only. A config change (#253) is only a command on the server's
 * config allowlist (ui/server/config.ts): toil's own commands for its
 * connections and dossiers, with the person's answers to their questions. The
 * Feedback (#265) is `toil feedback` alone, on `feedback`: read-only for the
 * dialog's preview, and sent only with the person's `consent`, which answers
 * the command's own consent question. The
 * agent (#251) answers on `agent/ask`, streamed as NDJSON when asked, and its
 * settings are `agent/settings`, the person's instructions and custom voice
 * among them (#283), and `agent/prompt` shows the system prompt a question
 * would get in the page's theme. `agent/mcp` is the one route without a
 * session: it serves one question's read tools to the Codex CLI, by that
 * question's bearer token, and refuses anything carrying a page's `Origin`.
 * The worklog (#308) is `worklog/month` and `worklog/day` to read, and
 * `worklog/rebuild`, `worklog/note` and `worklog/export`, each an explicit
 * press on the page: a note goes into the cache, and an export is a file
 * toil's file service writes in the folder the person named.
 * The building has one door, one key and a guest book, and the guest book is
 * toil's audit log.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import type { Answer } from '../src/agent.ts';
import type { Envelope, ExecutePerson } from '../src/toil.ts';
import type { AreaInfo, SettingsInfo } from '../src/config.ts';
import type { Agent } from './agent.ts';
import { AnswersError, CONFIG_COMMANDS, isConfigRead, personFrom, settingsFrom } from './config.ts';
import { AgentError } from './agents/cli.ts';
import type { AgentStatus } from './agents/host.ts';
import { answerMcp, McpGrants } from './agents/mcp.ts';
import type { ServeTools } from './agents/runtime.ts';
import { StyleError, styleFrom, type StyleChoice } from './agents/voices.ts';
import { localViewer, type RequestContext, type Viewer } from './context.ts';
import type { Settings } from './settings.ts';
import { READ_COMMANDS, type Access, type Store } from './store.ts';
import { SyncBusy, type SyncService } from './sync.ts';
import { WorklogRefusal, type ExportWhat, type WorklogApi } from '../src/worklog.ts';
import type { UsageControl } from './usage.ts';
import { assignmentRoute, type AssignmentControl } from './assign/routes.ts';
import { AssignError } from '../src/assign/queue.ts';
import { CHAT_ID, UsageSettingsError, type AnswerUsage, type ChatTurn } from '../src/model-usage.ts';

export interface UiServerOptions {
  settings: Settings;
  store: Store;
  agent: Agent;
  /** The built SPA (dist/app/). */
  appDir: string;
  /** Toil UI's own version, and the toil it runs on, for the session and refusals. */
  version: string;
  toil: { version: string; contractVersion: number };
  /** Commands `/api/config` may run (#253): CONFIG_COMMANDS unless a test narrows it. */
  configCommands?: ReadonlySet<string>;
  /** What the settings pages show beside the commands: the areas' connection fields, and the settings toil has no command for. */
  config?: { areas: AreaInfo[]; settings: SettingsInfo };
  /** The sync job and its cache (#250): `api/sync` and `api/cache/wipe`. None with sample data. */
  sync?: SyncService;
  /** The agent's settings (#251): `api/agent/settings`. None with sample data, which always uses the scripted agent. */
  agentControl?: AgentControl;
  /** The worklog (#308): the cache's pages, or the sample's. Absent, `api/worklog/*` says there is none. */
  worklog?: WorklogApi;
  /** The agent's model usage and its caps (#295): `api/usage`. */
  usage?: UsageControl;
  /** Assigning work items to an agent (#293): `api/assignments`. */
  assignments?: AssignmentControl;
  /** Tests pass a fixed token; a real start makes one. */
  token?: string;
  viewer?: Viewer;
}

/** What the Settings page reads and changes about the agent. */
export interface AgentControl {
  status(): AgentStatus;
  save(input: unknown): AgentStatus;
  /** The system prompt a question about the dossier gets now, in the page's style (#283). */
  systemPrompt(dossier: string, style: StyleChoice | null): string;
}

export interface UiServer {
  server: Server;
  /** Serves tools as an MCP server on `api/agent/mcp` for one run (Codex, #251). */
  serveTools: ServeTools;
  /** Starts listening; resolves with the address and the one URL to open. */
  listen(): Promise<{ origin: string; url: string; launchUrl: string }>;
  close(): Promise<void>;
}

/** A browser holds a session; a launch admits this many before the oldest is dropped (Bounds). */
export const MAX_SESSIONS = 32;
/** The largest POST body the API reads. Its calls are a command name and a few fields. */
export const MAX_BODY = 256 * 1024;
export const CSRF_HEADER = 'x-toil-ui-csrf';
/** The longest question the agent takes, in characters. */
export const MAX_PROMPT = 8000;
/** The session id the page got for the launch token, on every API call. Never a cookie. */
export const SESSION_HEADER = 'x-toil-ui-session';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export { CSP } from './csp.ts';
import { CSP } from './csp.ts';

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

interface Session {
  csrf: string;
}

const secret = () => randomBytes(32).toString('base64url');

/** The fields a feedback call carries: what the person typed, and nothing Toil UI knows. */
const FEEDBACK_FIELDS: ReadonlySet<string> = new Set(['kind', 'title', 'body', 'email']);
const FEEDBACK_SHAPE = 'Send { "fields": { "kind": "bug", "title": "…", "body": "…", "email": "you@example.com" } }, with "consent": true to send it.';

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly fix: string) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readJsonValue(req);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'The request body must be a JSON object.', 'Send a JSON object.');
  return body as Record<string, unknown>;
}

/** An agent's failure as the pane shows it: the message, and the fix when there is one. */
function agentFailure(e: unknown): { message: string; fix?: string; usage?: AnswerUsage } {
  if (e instanceof AgentError) return { message: e.message, fix: e.fix, ...(e.usage ? { usage: e.usage } : {}) };
  return { message: e instanceof Error ? e.message : String(e) };
}

/** The chat a question belongs to (#295), as the page numbers it, or none for a question of its own. */
function chatOf(value: unknown): ChatTurn | undefined {
  if (value === undefined) return undefined;
  const c = value as Record<string, unknown> | null;
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !CHAT_ID.test(c.id) || !Number.isInteger(c.turn) || (c.turn as number) < 1 || (c.turn as number) > 100_000) {
    throw new HttpError(400, 'chat is the chat a question belongs to: { "id": "<letters, digits and hyphens>", "turn": <1 or more> }.', 'Leave chat out to ask a question of its own.');
  }
  return { id: c.id, turn: c.turn as number };
}

/** The answer's style the page sent (#283): a built-in theme and the voice switch, or neither. */
function checkedStyle(body: Record<string, unknown>): StyleChoice | null {
  try {
    return styleFrom(body);
  } catch (e) {
    if (e instanceof StyleError) throw new HttpError(400, e.message, e.fix);
    throw e;
  }
}

async function readJsonValue(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, `The request body is over ${MAX_BODY / 1024} KB.`, 'Send one toil call per request.');
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, "The request body isn't JSON.", 'Send a JSON object.');
  }
  return body;
}

export function createUiServer(options: UiServerOptions): UiServer {
  const { settings, store, agent, appDir } = options;
  const token = options.token ?? secret();
  const viewer = options.viewer ?? localViewer();
  const configCommands = options.configCommands ?? CONFIG_COMMANDS;
  const configInfo = options.config ?? { areas: [], settings: settingsFrom(process.env) };
  const sessions = new Map<string, Session>();
  const base = settings.basePath;
  let host = '';
  const mcp = new McpGrants(() => `http://${host}${base}api/agent/mcp`);

  const send = (res: ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) => {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': String(Buffer.byteLength(body)), ...extra });
    res.end(res.req.method === 'HEAD' ? undefined : body);
  };
  const json = (res: ServerResponse, status: number, value: unknown) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));
  const text = (res: ServerResponse, status: number, message: string) => send(res, status, 'text/plain; charset=utf-8', `${message}\n`);

  /** A refusal in toil's own envelope, so the page shows it the way it shows any failed call. */
  const refusal = (command: string, message: string, fix: string): Envelope => ({
    ok: false,
    data: null,
    error: { code: 'INVALID_INPUT', message, fix },
    meta: { command, durationMs: 0, version: options.toil.version, contractVersion: options.toil.contractVersion },
  } as Envelope);

  /** What the page needs about the server, and its session's CSRF token. */
  const sessionInfo = (id: string, session: Session) => ({
    session: id,
    csrf: session.csrf,
    version: options.version,
    toil: options.toil,
    viewer: { id: viewer.id, name: viewer.name },
    store: store.kind,
    sync: options.sync !== undefined,
    agent: agent.kind,
    agentSettings: options.agentControl !== undefined,
    assignments: options.assignments !== undefined,
    sample: store.sample,
    now: store.now(),
  });

  /** The agent's settings, or a 404 saying the sample always uses the scripted agent. */
  const control = (): AgentControl => {
    if (!options.agentControl) throw new HttpError(404, 'This Toil UI serves sample data, which always answers with the scripted agent.', 'Start toil-ui without --sample to choose an agent.');
    return options.agentControl;
  };

  /**
   * An answer as it streams: NDJSON, one line per version of the answer, each
   * the whole of it so far, ending with `{ "done": true }`, or with
   * `{ "error": … }` when the agent fails partway. NDJSON over fetch, not SSE,
   * because the session is a header and EventSource can't send one (#250).
   */
  const streamAnswer = async (res: ServerResponse, answers: AsyncIterable<Answer>) => {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/x-ndjson; charset=utf-8' });
    try {
      for await (const answer of answers) {
        if (res.destroyed) return;
        res.write(`${JSON.stringify({ answer })}\n`);
      }
      res.end(`${JSON.stringify({ done: true })}\n`);
    } catch (e) {
      if (!res.destroyed) res.end(`${JSON.stringify({ error: agentFailure(e) })}\n`);
    }
  };

  /**
   * `POST api/agent/mcp`: the tools of one agent run, for an SDK that takes
   * them only from an MCP server (Codex). It needs that run's bearer token,
   * and no Origin at all: the caller is the agent CLI, never a page.
   */
  const mcpCall = async (req: IncomingMessage, res: ServerResponse, ctx: RequestContext) => {
    if (req.headers.origin !== undefined) throw new HttpError(403, "Toil UI's MCP endpoint takes no requests from a web page.", 'Only the agent CLI Toil UI starts calls it.');
    const tools = mcp.tools(req.headers.authorization);
    if (!tools) throw new HttpError(401, "That isn't the token of a running agent question.", 'The endpoint serves an agent CLI for the length of one question only.');
    if (!/^application\/json(\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'The MCP endpoint takes JSON only.', 'Send Content-Type: application/json.');
    const body = await readJsonValue(req);
    const out = await answerMcp(body, tools, options.version, ctx.signal);
    if (out === null) return send(res, 202, 'text/plain; charset=utf-8', '');
    json(res, 200, out);
  };

  /** The worklog, or a 404 saying this server keeps none. */
  const worklog = () => {
    if (!options.worklog) throw new HttpError(404, 'This Toil UI keeps no worklog.', 'Start toil-ui with a cache to keep one.');
    return options.worklog;
  };
  /** A worklog call, with its refusals as the page shows them. */
  const worklogCall = async (res: ServerResponse, call: () => Promise<unknown>) => {
    try {
      json(res, 200, await call());
    } catch (e) {
      if (e instanceof WorklogRefusal) throw new HttpError(e.status, e.message, e.fix);
      throw e;
    }
  };
  /** A worklog call takes its fields and no others, so a misspelt one is an error rather than ignored. */
  const only = (body: Record<string, unknown>, fields: string[], what: string, shape: string) => {
    const extra = Object.keys(body).filter((k) => !fields.includes(k));
    if (extra.length) throw new HttpError(400, `${what}, not ${extra.join(', ')}.`, shape);
  };
  const named = (value: unknown, what: string, shape: string) => {
    if (typeof value !== 'string' || !value) throw new HttpError(400, `Name the ${what}.`, shape);
    return value;
  };
  /** The usage view, or a 404 when this server keeps none. */
  const usage = (): UsageControl => {
    if (!options.usage) throw new HttpError(404, 'This Toil UI keeps no record of model usage.', 'Start toil-ui with its cache to record what the agent uses.');
    return options.usage;
  };

  /** The sync job, or a 404 saying this server has none (sample data syncs nothing). */
  const syncer = (): SyncService => {
    if (!options.sync) throw new HttpError(404, 'This Toil UI has no cache to sync: it serves sample data.', 'Start toil-ui without --sample to sync your own dossiers.');
    return options.sync;
  };

  const sessionOf = (req: IncomingMessage): { id: string; session: Session } | undefined => {
    const id = req.headers[SESSION_HEADER];
    if (typeof id !== 'string' || !id) return undefined;
    for (const [key, session] of sessions) if (same(key, id)) return { id: key, session };
    return undefined;
  };

  /** A POST must come from this page: its Origin and a JSON body. */
  const checkOrigin = (req: IncomingMessage) => {
    if (req.headers.origin !== `http://${host}`) throw new HttpError(403, `This server takes requests only from its own page, http://${host}.`, 'Use Toil UI in the browser tab its launch URL opened.');
    if (!/^application\/json(\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'The API takes JSON only.', 'Send Content-Type: application/json.');
  };

  /** And, once signed in, the session's CSRF token. */
  const checkCsrf = (req: IncomingMessage, session: Session) => {
    const csrf = req.headers[CSRF_HEADER];
    if (typeof csrf !== 'string' || !same(csrf, session.csrf)) throw new HttpError(403, "The request didn't carry this session's CSRF token.", `Send the csrf value ${base}api/session gave in the ${CSRF_HEADER} header.`);
  };

  /** `POST api/session`: the launch token for a new session id, which the page keeps in memory. */
  const signIn = async (req: IncomingMessage, res: ServerResponse) => {
    checkOrigin(req);
    const body = await readJson(req);
    if (typeof body.token !== 'string' || !same(body.token, token)) {
      throw new HttpError(401, "That isn't this launch's token.", 'Open the URL toil-ui printed when it started; each start prints a new one.');
    }
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
    const id = secret();
    const session: Session = { csrf: secret() };
    sessions.set(id, session);
    json(res, 200, sessionInfo(id, session));
  };

  const run = async (req: IncomingMessage, res: ServerResponse, ctx: RequestContext, access: Access) => {
    const body = await readJson(req);
    const command = body.command;
    const input = body.input ?? {};
    if (typeof command !== 'string') throw new HttpError(400, 'The call needs a command name.', 'Send { "command": "dossiers list", "input": {} }.');
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new HttpError(400, 'The call\'s input must be an object of the command\'s fields.', 'Send { "command": "dossiers show", "input": { "dossier": "<name>" } }.');
    const allowed = access === 'read' ? READ_COMMANDS : configCommands;
    if (!allowed.has(command)) {
      const message = access === 'read'
        ? `Toil UI doesn't run toil ${command} from the page: it runs only the reads its views make.`
        : `Toil UI doesn't change ${command} from the page: its settings pages run only toil's commands for its own connections and dossiers.`;
      json(res, 403, refusal(command, message, `Run toil ${command} on the CLI, where toil's own rules apply.`));
      return;
    }
    if (access === 'read') {
      json(res, 200, await store.execute(ctx, command, input as Record<string, unknown>, access));
      return;
    }
    // A config read runs read-only. A change runs with the person's answers, which go to toil and nowhere else.
    const readOnly = isConfigRead(command);
    let person;
    try {
      person = readOnly ? undefined : personFrom(body);
    } catch (e) {
      if (e instanceof AnswersError) throw new HttpError(400, e.message, e.fix);
      throw e;
    }
    json(res, 200, await store.execute(ctx, command, input as Record<string, unknown>, access, { readOnly, ...(person ? { person } : {}) }));
  };

  /**
   * `POST api/feedback` (#265): `toil feedback`, and no other command, with the
   * dialog's four fields. Without `consent` it runs read-only, which only
   * previews; with `consent: true`, ticked by the person for the report on
   * screen, it runs with a person whose one answer is yes to the command's
   * consent question. Toil UI adds nothing to the fields.
   */
  const feedbackCall = async (req: IncomingMessage, res: ServerResponse, ctx: RequestContext) => {
    const body = await readJson(req);
    const extra = Object.keys(body).filter((k) => k !== 'fields' && k !== 'consent');
    if (extra.length) throw new HttpError(400, `A feedback call takes fields and consent, not ${extra.join(', ')}.`, FEEDBACK_SHAPE);
    const fields = body.fields;
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields) || Object.entries(fields).some(([k, v]) => !FEEDBACK_FIELDS.has(k) || typeof v !== 'string')) {
      throw new HttpError(400, "A feedback call's fields are kind, title, body and email, each as text.", FEEDBACK_SHAPE);
    }
    if (body.consent !== undefined && body.consent !== true) throw new HttpError(400, 'consent is true, once the person has agreed to send the report on screen, or left out for a preview.', FEEDBACK_SHAPE);
    const consent = body.consent === true;
    const person: ExecutePerson = { ask: (q) => (q.id === 'consent' ? (consent ? 'yes' : 'no') : undefined) };
    json(res, 200, await store.execute(ctx, 'feedback', fields as Record<string, unknown>, 'feedback', { readOnly: !consent, person }));
  };

  const api = async (req: IncomingMessage, res: ServerResponse, route: string, url: URL, ctx: RequestContext) => {
    const key = `${req.method === 'HEAD' ? 'GET' : req.method} ${route}`;
    if (key === 'POST session') return signIn(req, res);
    if (key === 'POST agent/mcp') return mcpCall(req, res, ctx);
    const signedIn = sessionOf(req);
    if (!signedIn) {
      throw new HttpError(401, `The API answers only a page signed in to this launch, with its session id in ${SESSION_HEADER}.`, 'Open the URL toil-ui printed when it started; a reloaded page needs it again.');
    }
    if (req.method === 'POST') {
      checkOrigin(req);
      checkCsrf(req, signedIn.session);
    }
    if (await assignmentRoute(key, req, res, url, options.assignments, { readJson, json, headers: SECURITY_HEADERS })) return;
    switch (key) {
      case 'GET session':
        json(res, 200, sessionInfo(signedIn.id, signedIn.session));
        return;
      case 'POST execute':
        return run(req, res, ctx, 'read');
      case 'POST config':
        return run(req, res, ctx, 'config');
      case 'POST feedback':
        return feedbackCall(req, res, ctx);
      case 'GET config/areas':
        json(res, 200, configInfo.areas);
        return;
      case 'GET config/settings':
        json(res, 200, configInfo.settings);
        return;
      case 'GET agent/starters': {
        const dossier = url.searchParams.get('dossier');
        if (!dossier) throw new HttpError(400, 'Name the dossier.', `Ask ${base}api/agent/starters?dossier=<name>.`);
        json(res, 200, await agent.starters(ctx, dossier));
        return;
      }
      case 'POST agent/ask': {
        const body = await readJson(req);
        if (typeof body.dossier !== 'string' || typeof body.prompt !== 'string') throw new HttpError(400, 'A question needs a dossier and a prompt.', 'Send { "dossier": "<name>", "prompt": "<question>", "theme": "<theme>", "voice": true }.');
        if (body.prompt.length > MAX_PROMPT) throw new HttpError(413, `A question is at most ${MAX_PROMPT} characters.`, 'Ask a shorter question.');
        const style = checkedStyle(body);
        const chat = chatOf(body.chat);
        if (body.stream === true && agent.stream) return streamAnswer(res, agent.stream(ctx, body.dossier, body.prompt, style, chat));
        try {
          json(res, 200, await agent.ask(ctx, body.dossier, body.prompt, style, chat));
        } catch (e) {
          json(res, 502, { error: agentFailure(e) });
        }
        return;
      }
      case 'GET agent/prompt': {
        // Read-only: the prompt as the next question would get it, with the saved instructions. `voice` is on or off.
        const dossier = url.searchParams.get('dossier') || '<dossier>';
        if (dossier.length > 200) throw new HttpError(400, 'That dossier name is over 200 characters.', 'Name a dossier toil dossiers list shows.');
        const voice = url.searchParams.get('voice');
        if (voice !== 'on' && voice !== 'off') throw new HttpError(400, 'Say whether the voice is on.', `Ask ${base}api/agent/prompt?theme=<name>&voice=on (or off).`);
        const style = checkedStyle({ theme: url.searchParams.get('theme') ?? undefined, voice: voice === 'on' });
        json(res, 200, { dossier, prompt: control().systemPrompt(dossier, style) });
        return;
      }
      case 'GET agent/settings':
        json(res, 200, control().status());
        return;
      case 'POST agent/settings': {
        const body = await readJson(req);
        try {
          json(res, 200, control().save(body));
        } catch (e) {
          if (e instanceof AgentError) throw new HttpError(400, e.message, e.fix);
          throw e;
        }
        return;
      }
      case 'GET usage':
        json(res, 200, usage().view());
        return;
      case 'POST usage/settings': {
        const body = await readJson(req);
        try {
          json(res, 200, usage().save(body));
        } catch (e) {
          if (e instanceof UsageSettingsError) throw new HttpError(400, e.message, e.fix);
          throw e;
        }
        return;
      }
      case 'GET sync':
        json(res, 200, syncer().status());
        return;
      case 'POST sync': {
        const body = await readJson(req);
        if (body.dossier !== undefined && typeof body.dossier !== 'string') throw new HttpError(400, 'dossier must be a dossier name.', 'Send {} to sync every dossier, or { "dossier": "<name>" } for one.');
        try {
          syncer().start(ctx, body.dossier as string | undefined);
        } catch (e) {
          if (e instanceof SyncBusy) throw new HttpError(409, e.message, 'Wait for it to finish; the page shows its progress.');
          throw e;
        }
        json(res, 202, syncer().status());
        return;
      }
      case 'POST cache/wipe': {
        const body = await readJson(req);
        if (body.confirm !== 'wipe') throw new HttpError(400, 'Wiping the cache needs { "confirm": "wipe" }.', 'Confirm in the page; it deletes everything synced on this machine.');
        try {
          // The assignments live under the cache too, and one that is running holds it, as a sync does.
          if (options.assignments?.queue.busy) throw new HttpError(409, 'An assignment is running, so the cache stays until it ends.', 'Stop it from its page, or wait for it to finish, then wipe.');
          syncer().wipe();
          options.assignments?.queue.wipe();
        } catch (e) {
          if (e instanceof SyncBusy) throw new HttpError(409, 'A sync is running, so the cache stays until it ends.', 'Wait for the sync to finish, then wipe.');
          throw e;
        }
        json(res, 200, syncer().status());
        return;
      }
      case 'GET worklog/month': {
        const dossier = named(url.searchParams.get('dossier'), 'dossier', `Ask ${base}api/worklog/month?dossier=<name>&month=<yyyy-mm>.`);
        return worklogCall(res, () => worklog().month(dossier, url.searchParams.get('month') ?? undefined));
      }
      case 'GET worklog/day': {
        const dossier = named(url.searchParams.get('dossier'), 'dossier', `Ask ${base}api/worklog/day?dossier=<name>&day=<yyyy-mm-dd>.`);
        const day = named(url.searchParams.get('day'), 'day', `Ask ${base}api/worklog/day?dossier=<name>&day=<yyyy-mm-dd>.`);
        return worklogCall(res, () => worklog().day(dossier, day));
      }
      case 'POST worklog/rebuild': {
        const body = await readJson(req);
        const shape = 'Send { "dossier": "<name>", "day": "<yyyy-mm-dd>" }.';
        only(body, ['dossier', 'day'], 'A rebuild takes dossier and day', shape);
        return worklogCall(res, () => worklog().rebuild(named(body.dossier, 'dossier', shape), named(body.day, 'day', shape)));
      }
      case 'POST worklog/note': {
        const body = await readJson(req);
        const shape = 'Send { "dossier": "<name>", "text": "<the note>" }.';
        only(body, ['dossier', 'text'], 'A note takes dossier and text', shape);
        if (typeof body.text !== 'string') throw new HttpError(400, 'A note needs its text.', shape);
        return worklogCall(res, () => worklog().addNote(named(body.dossier, 'dossier', shape), body.text as string, viewer.name));
      }
      case 'POST worklog/export': {
        const body = await readJson(req);
        const shape = 'Send { "dossier": "<name>", "day": "<yyyy-mm-dd>" } or { "dossier": "<name>", "month": "<yyyy-mm>" }, with "folder": "<a full path>".';
        only(body, ['dossier', 'day', 'month', 'folder'], 'An export takes dossier, day or month, and folder', shape);
        if ((body.day === undefined) === (body.month === undefined)) throw new HttpError(400, 'Export a day or a month, one of the two.', shape);
        const what: ExportWhat = body.day !== undefined ? { day: named(body.day, 'day', shape) } : { month: named(body.month, 'month', shape) };
        return worklogCall(res, () => worklog().exportTo(named(body.dossier, 'dossier', shape), what, named(body.folder, 'folder', shape)));
      }
      default:
        throw new HttpError(404, `There is no ${key} in the API.`, `The API is under ${base}api/: session, execute, config, config/areas, config/settings, feedback, sync, cache/wipe, usage, usage/settings, worklog/month, worklog/day, worklog/rebuild, worklog/note, worklog/export, agent/starters, agent/ask, agent/prompt, agent/settings, agent/mcp and assignments.`);
    }
  };

  const serveFile = async (res: ServerResponse, route: string) => {
    let rel: string;
    try {
      rel = decodeURIComponent(route) || 'index.html';
    } catch {
      return text(res, 400, 'That path is not valid.');
    }
    const file = normalize(join(appDir, rel));
    const inside = relative(appDir, file);
    // A colon is never in an app file's name, and on Windows it would name a stream of one (`index.html::$DATA`).
    if (rel.includes('\0') || rel.includes(':') || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return text(res, 404, 'Not found.');
    try {
      if (!(await stat(file)).isFile()) return text(res, 404, 'Not found.');
      send(res, 200, TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', await readFile(file));
    } catch {
      text(res, 404, 'Not found.');
    }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    // Before anything else: a Host this server didn't print is a page trying to reach the port by another name.
    if ((req.headers.host ?? '').toLowerCase() !== host) return text(res, 403, `This server answers only to http://${host}. Open the URL toil-ui printed when it started.`);
    const url = new URL(req.url ?? '/', `http://${host}`);
    const path = url.pathname;
    if (path === base.slice(0, -1)) return send(res, 308, 'text/plain; charset=utf-8', '', { Location: `${base}${url.search}` });
    if (!path.startsWith(base)) return text(res, 404, `Toil UI is served under ${base}.`);
    const route = path.slice(base.length);
    const isApi = route.startsWith('api/');
    if (req.method !== 'GET' && req.method !== 'HEAD' && !(isApi && req.method === 'POST')) {
      return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed.\n', { Allow: isApi ? 'GET, HEAD, POST' : 'GET, HEAD' });
    }
    // The app's files hold no data, so they need no session; the page signs in through the API.
    if (!isApi) return serveFile(res, route);

    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const ctx: RequestContext = { viewer, signal: controller.signal };
    try {
      await api(req, res, route.slice('api/'.length), url, ctx);
    } catch (e) {
      if (res.headersSent) return;
      if (e instanceof HttpError || e instanceof AssignError) return json(res, e.status, { error: { message: e.message, fix: e.fix } });
      json(res, 500, { error: { message: `Toil UI failed answering ${route}: ${e instanceof Error ? e.message : String(e)}`, fix: 'This is a bug in Toil UI; report it with the message.' } });
    }
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) text(res, 500, 'Toil UI failed answering the request.');
      else res.destroy();
    });
  });

  return {
    server,
    serveTools: (tools) => mcp.serve(tools),
    listen: () =>
      new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(settings.port, settings.host, () => {
          server.off('error', reject);
          const { port } = server.address() as AddressInfo;
          host = settings.host.includes(':') ? `[${settings.host}]:${port}` : `${settings.host}:${port}`;
          const origin = `http://${host}`;
          resolveListen({ origin, url: `${origin}${base}`, launchUrl: `${origin}${base}?token=${token}` });
        });
      }),
    close: async () => {
      await options.sync?.close();
      await new Promise<void>((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      });
    },
  };
}
