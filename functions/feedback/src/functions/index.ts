// The function app's entry: four registrations on the v4 programming model,
// each a thin wrapper that builds the dependencies and calls a handler in
// ../lib/handlers.ts, where every rule lives and is tested. The wrappers do no
// deciding of their own, like a front desk that only stamps the form.

import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { readSettings } from '../lib/config.js';
import { acsMailer, type Mailer } from '../lib/email.js';
import { GitHub } from '../lib/github.js';
import { processSubmissions, report, submit, webhook, type Deps, type HttpOut } from '../lib/handlers.js';
import { azureTables, type Tables } from '../lib/tables.js';

// One set per instance, reused across invocations: the token cache in GitHub
// and the table clients are worth keeping warm. Settings are read once too,
// because the platform restarts the app when they change.
let shared: { settings: ReturnType<typeof readSettings>; tables: Tables; github?: GitHub; mailer?: Mailer } | undefined;

function deps(context: InvocationContext): Deps {
  if (!shared) {
    const settings = readSettings();
    const endpoint = process.env.FEEDBACK_TABLES_ENDPOINT ?? process.env.AzureWebJobsStorage;
    if (!endpoint) throw new Error('FEEDBACK_TABLES_ENDPOINT is not set, so there is nowhere to keep submissions.');
    shared = { settings, tables: azureTables(endpoint) };
  }
  const state = shared;
  return {
    settings: state.settings,
    tables: state.tables,
    github: () => {
      const { githubAppId, githubPrivateKey, repo, mainBranch, githubApi } = state.settings;
      if (!githubAppId || !githubPrivateKey) throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must both be set to file issues.');
      return (state.github ??= new GitHub({ appId: githubAppId, privateKey: githubPrivateKey, repo, mainBranch, api: githubApi }));
    },
    mailer: () => {
      if (!state.settings.acsConnectionString) throw new Error('ACS_CONNECTION_STRING must be set to send email.');
      return (state.mailer ??= acsMailer(state.settings.acsConnectionString, state.settings.emailFrom));
    },
    log: { info: (m) => context.log(m), warn: (m) => context.warn(m), error: (m) => context.error(m) },
  };
}

const json = (out: HttpOut): HttpResponseInit => ({ status: out.status, jsonBody: out.body });

async function guarded(context: InvocationContext, run: () => Promise<HttpOut>): Promise<HttpResponseInit> {
  try {
    return json(await run());
  } catch (error) {
    context.error(`Unhandled: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return json({ status: 500, body: { ok: false, error: 'Something failed on our side. Nothing was lost on yours; try again in a few minutes.' } });
  }
}

app.http('Submit', {
  route: 'submit',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: (request: HttpRequest, context: InvocationContext) => guarded(context, () => submit(request, deps(context))),
});

app.http('Report', {
  route: 'report',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: (request: HttpRequest, context: InvocationContext) => guarded(context, () => report(request, deps(context))),
});

app.http('IssueWebhook', {
  route: 'webhook/issue',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request: HttpRequest, context: InvocationContext) =>
    guarded(context, async () => webhook({ headers: request.headers, raw: await request.text() }, deps(context))),
});

app.timer('ProcessSubmissions', {
  schedule: '0 * * * * *',
  handler: async (_timer, context: InvocationContext) => {
    const result = await processSubmissions(deps(context));
    if (result.failed > 0) context.warn(`ProcessSubmissions: ${result.failed} submission(s) failed this run.`);
  },
});
