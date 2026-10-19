// Installs both tarballs the way a locked-down user would (npm, scripts off,
// no registry) into a throwaway prefix, then drives the installed toil-ui bin:
// it prints its launch URL once, refuses a foreign Host and a missing token,
// trades the token for a session cookie, serves the app, answers the API with
// the CSRF token and refuses it without, and reads through the installed toil
// with no sample data at all. Run after `npm run build` at the root (toil's
// tarball) and in ui/ (its own). Stops every process it starts.
// The tour of the building takes nine seconds and visits only the lobby.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { npmCli } from './package-rules.mjs';

const ui = join(import.meta.dirname, '..');
const repo = join(ui, '..');
const work = mkdtempSync(join(tmpdir(), 'toil-ui-smoke-'));
const home = join(work, 'home');
const env = { ...process.env, HOME: home, USERPROFILE: home, TOIL_UI_DATA_DIR: join(work, 'data') };
for (const key of Object.keys(env)) if (/^TOIL_(CONN_|DOSSIER)/.test(key)) delete env[key];
const npm = (args, cwd) => execFileSync(process.execPath, [npmCli(), ...args], { cwd, encoding: 'utf8', env });
const steps = [];
const problems = [];
const check = (ok, message) => (ok ? null : problems.push(message));

function send(origin, path, { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method, headers: { host: url.host, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** Starts the installed bin and resolves with its printed launch URL. */
function launch(bin, args) {
  const child = spawn(process.execPath, [bin, '--port', '0', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  const url = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`toil-ui printed no URL in 15s. stdout: ${out} stderr: ${err}`)), 15000);
    child.stdout.on('data', (c) => {
      out += c;
      const m = /http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
    child.stderr.on('data', (c) => (err += c));
    child.on('exit', (code) => reject(new Error(`toil-ui exited ${code} before printing a URL. stderr: ${err}`)));
  });
  return { child, url, output: () => out };
}

async function signIn(launchUrl) {
  const { origin } = new URL(launchUrl);
  const res = await send(origin, launchUrl);
  check(res.status === 303, `the launch URL answered ${res.status}, not 303`);
  const cookie = String(res.headers['set-cookie']?.[0] ?? '').split(';')[0];
  const session = JSON.parse((await send(origin, '/api/session', { headers: { cookie } })).body);
  const call = (command, input = {}, headers = {}) =>
    send(origin, '/api/execute', { method: 'POST', body: JSON.stringify({ command, input }), headers: { cookie, origin, 'content-type': 'application/json', 'x-toil-ui-csrf': session.csrf, ...headers } });
  return { origin, cookie, session, call };
}

const children = [];
try {
  // Both tarballs, from this checkout.
  const toilTgz = join(work, JSON.parse(npm(['pack', '--ignore-scripts', '--pack-destination', work, '--json'], repo))[0].filename);
  const uiTgz = join(work, JSON.parse(npm(['pack', '--ignore-scripts', '--pack-destination', work, '--json'], ui))[0].filename);
  const prefix = join(work, 'install');
  // --offline: toil-ui's one dependency is the toil tarball beside it, so nothing comes from a registry.
  npm(['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', '--offline', toilTgz, uiTgz], work);
  const installed = join(prefix, 'node_modules', '@imagile-dev');
  const bin = join(installed, 'toil-ui', 'dist', 'server', 'toil-ui.js');
  const pinned = JSON.parse(readFileSync(join(installed, 'toil-ui', 'package.json'), 'utf8')).dependencies['@imagile-dev/toil'];
  const toilInstalled = JSON.parse(readFileSync(join(installed, 'toil', 'package.json'), 'utf8')).version;
  check(pinned === toilInstalled, `toil-ui pins toil ${pinned}, but the install holds ${toilInstalled}`);
  check(!existsSync(join(prefix, 'node_modules', 'react')), 'the install holds react; the front end must be built in, not installed');
  steps.push(`installed toil ${toilInstalled} and toil-ui offline with scripts off (no react: the front end is built in)`);

  const version = execFileSync(process.execPath, [bin, '--version'], { env, encoding: 'utf8' }).trim();
  check(version.includes(`(toil ${toilInstalled})`), `toil-ui --version printed ${version}`);

  // Sample data first: the views' calls, end to end.
  const sample = launch(bin, ['--sample']);
  children.push(sample.child);
  const launchUrl = await sample.url;
  const { origin } = new URL(launchUrl);
  check(sample.output().split(launchUrl).length === 2, 'the launch URL was printed more than once');

  const foreign = await send(origin, launchUrl, { headers: { host: 'rebind.imagile.dev' } });
  check(foreign.status === 403 && !foreign.headers['set-cookie'], `a foreign Host got ${foreign.status}`);
  check((await send(origin, '/')).status === 401, 'the app opened without the token');
  check((await send(origin, '/?token=wrong')).status === 401, 'a wrong token was accepted');

  const s = await signIn(launchUrl);
  const page = await send(origin, '/', { headers: { cookie: s.cookie } });
  check(page.status === 200 && page.body.includes('<div id="root">') && page.body.includes('<title>Toil UI</title>'), `the app page answered ${page.status}`);
  const script = /src="\.\/(assets\/[^"]+\.js)"/.exec(page.body)?.[1];
  const asset = script ? await send(origin, `/${script}`, { headers: { cookie: s.cookie } }) : { status: 0, headers: {} };
  check(asset.status === 200 && String(asset.headers['content-type']).startsWith('text/javascript'), `the app's script ${script} answered ${asset.status}`);
  // The package's app is the local entry, which reads through the server, not the preview's fixtures.
  check(asset.body.includes('api/session') && !asset.body.includes('The preview has no sample answer'), `the app's script ${script} is the preview's build, not the local app's`);
  check(s.session.store === 'fixture' && s.session.sample === true && s.session.toil.version === toilInstalled, `the session was ${JSON.stringify(s.session)}`);
  const list = JSON.parse((await s.call('dossiers list')).body);
  check(list.ok && list.data.dossiers.length === 3, `dossiers list over the API returned ${JSON.stringify(list).slice(0, 200)}`);
  const refused = await s.call('jira create-issue', { project: 'PAY' });
  check(refused.status === 403 && JSON.parse(refused.body).ok === false, `a write command got ${refused.status}`);
  const noCsrf = await s.call('dossiers list', {}, { 'x-toil-ui-csrf': 'wrong' });
  check(noCsrf.status === 403, `a POST without the CSRF token got ${noCsrf.status}`);
  const all = [foreign, page, asset, refused, noCsrf];
  check(all.every((r) => !Object.keys(r.headers).some((h) => h.startsWith('access-control-'))), 'a response carried a CORS header');
  steps.push(`--sample on ${origin}: foreign Host 403, no token 401, token 303 + cookie, app and script 200, 3 dossiers over the API, a write refused, no CSRF 403, no CORS header`);

  // toil's own execute(), from the installed package, with an empty home.
  const live = launch(bin, []);
  children.push(live.child);
  const l = await signIn(await live.url);
  check(l.session.store === 'toil' && l.session.agent === 'none' && l.session.sample === false, `the live session was ${JSON.stringify(l.session)}`);
  const liveList = JSON.parse((await l.call('dossiers list')).body);
  check(liveList.ok === true && Array.isArray(liveList.data?.dossiers) && liveList.meta?.command === 'dossiers list', `dossiers list through the installed toil returned ${JSON.stringify(liveList).slice(0, 300)}`);
  steps.push(`live on ${l.origin}: dossiers list through the installed toil's execute() returned ok with ${liveList.data?.dossiers?.length} dossiers`);
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
} finally {
  for (const child of children) child.kill();
  await new Promise((r) => setTimeout(r, 200));
  rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}

if (problems.length) {
  console.error(`ui smoke found ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`ui smoke ok:\n${steps.map((s) => `  - ${s}`).join('\n')}`);
