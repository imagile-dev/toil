// Takes the screenshots a site PR needs (the `site` skill): every page given,
// at desktop width and at 375px, full height, from headless Chrome with a
// throwaway profile. It also measures each page at 375px and 320px and fails
// if anything scrolls sideways, which is the check the skill asks for before
// a PR opens.
//
//   npm --prefix site run dev                     # in another terminal
//   node scripts/shoot.mjs connect/jira/ connect/
//   (no leading slash, so Git Bash on Windows leaves the paths alone)
//   node scripts/shoot.mjs --base http://localhost:4321/toil --out <dir>   # the home page
//
// Shots go to <os temp>/toil-shots unless --out says otherwise: scratch stays out of the repo.
//
// Widths are set through the DevTools protocol, so a 375px page doesn't need
// the iframe trick headless windows on Windows otherwise require. Reduced
// motion is on, so scroll reveals have nothing to hide. Chrome comes from
// CHROME_PATH, or the usual install locations of Chrome, Edge or Chromium.
// Repo tooling only: nothing here ships. Photographic evidence was requested,
// in duplicate, at two sizes.
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/* global WebSocket */
const args = process.argv.slice(2);
const take = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args.splice(at, 2)[1] : fallback;
};
const base = take('--base', 'http://localhost:4321/toil').replace(/\/$/, '');
const out = take('--out', join(tmpdir(), 'toil-shots'));
const pages = args.length > 0 ? args : ['/'];

const WIDTHS = [
  { name: 'desktop', width: 1440, mobile: false, shot: true },
  { name: '375', width: 375, mobile: true, shot: true },
  { name: '320', width: 320, mobile: true, shot: false },
];

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = {
    win32: [
      join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  }[process.platform];
  const onPath = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].flatMap((name) =>
    (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, name)),
  );
  const found = [...(candidates ?? []), ...onPath].find((p) => p && existsSync(p));
  if (!found) throw new Error('No Chrome, Edge or Chromium found. Set CHROME_PATH to one.');
  return found;
}

/** Starts headless Chrome and resolves with its DevTools websocket URL. */
function launch(profile) {
  const chrome = spawn(findChrome(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let seen = '';
    chrome.stderr.on('data', (chunk) => {
      seen += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(seen);
      if (match) resolve({ chrome, endpoint: match[1] });
    });
    chrome.on('exit', (code) => reject(new Error(`Chrome exited (${code}) before DevTools was ready:\n${seen}`)));
  });
}

/** A minimal DevTools protocol session over one websocket. */
function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return {
    ready,
    send: (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }));
      }),
    once: (method, sessionId, match = () => true) =>
      new Promise((resolve) => {
        const l = (msg) => {
          if (msg.method === method && msg.sessionId === sessionId && match(msg.params)) {
            listeners.splice(listeners.indexOf(l), 1);
            resolve(msg.params);
          }
        };
        listeners.push(l);
      }),
    close: () => ws.close(),
  };
}

const slug = (path) => path.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'home';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(cdp, sessionId, url, { width, mobile }, file) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile }, sessionId);
  // A URL that differs from the last only after `#` (the Toil UI preview's
  // views) would be a same-page jump with no new document, so start each shot
  // from a blank page.
  const blank = cdp.once('Page.loadEventFired', sessionId);
  await cdp.send('Page.navigate', { url: 'about:blank' }, sessionId);
  await blank;
  const loaded = cdp.once('Page.loadEventFired', sessionId);
  const response = cdp.once('Network.responseReceived', sessionId, (p) => p.type === 'Document');
  const nav = await cdp.send('Page.navigate', { url }, sessionId);
  if (nav.errorText) throw new Error(`${url}: ${nav.errorText}`);
  const timeout = (ms, what) => new Promise((_, reject) => setTimeout(() => reject(new Error(`${url}: no ${what} after ${ms / 1000}s`)), ms).unref());
  const { response: doc } = await Promise.race([response, timeout(30000, 'response')]);
  if (doc.status >= 400) throw new Error(`${url}: HTTP ${doc.status}`);
  await Promise.race([loaded, timeout(30000, 'load event')]);
  await cdp.send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true }, sessionId);
  await wait(300);
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify([document.documentElement.scrollWidth, document.documentElement.scrollHeight])', returnByValue: true }, sessionId);
  const [scrollWidth, scrollHeight] = JSON.parse(result.value);
  if (file) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: Math.min(scrollHeight, 16000), deviceScaleFactor: 1, mobile }, sessionId);
    await wait(200);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
    writeFileSync(file, Buffer.from(data, 'base64'));
  }
  return { scrollWidth, scrollHeight };
}

/**
 * Chrome on Windows can hold its profile's files for a moment after it's
 * killed, and rmSync then fails with EPERM or EBUSY once the shots are already
 * written. Retry for a few seconds; if the folder still won't go, say where it
 * is and carry on, since a leftover temp folder isn't a failed screenshot.
 */
async function removeProfile(profile) {
  for (let attempt = 0; ; attempt++) {
    await wait(300);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      return;
    } catch (err) {
      if (attempt >= 10 || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(err.code)) {
        console.warn(`Couldn't remove the Chrome profile ${profile} (${err.code ?? err.message}); delete it by hand.`);
        return;
      }
    }
  }
}

async function main() {
  mkdirSync(out, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'toil-shoot-'));
  const { chrome, endpoint } = await launch(profile);
  const cdp = connect(endpoint);
  const problems = [];
  try {
    await cdp.ready;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    for (const page of pages) {
      const url = `${base}${page.startsWith('/') ? page : `/${page}`}`;
      for (const w of WIDTHS) {
        const file = w.shot ? join(out, `${slug(page)}-${w.name}.png`) : undefined;
        const { scrollWidth } = await shoot(cdp, sessionId, url, w, file);
        const wide = scrollWidth > w.width;
        if (wide) problems.push(`${page} at ${w.width}px scrolls sideways: scrollWidth ${scrollWidth}`);
        console.log(`${page} ${w.name}: scrollWidth ${scrollWidth}${wide ? ' (too wide)' : ''}${file ? ` -> ${file}` : ''}`);
      }
    }
  } finally {
    cdp.close();
    chrome.kill();
    await removeProfile(profile);
  }
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  }
}

await main();
