// Headless Chrome over the DevTools protocol, for the layout check
// (scripts/layout-check.mjs): find a browser that is already installed, start
// it with a throwaway profile, and talk to it over its websocket. No package:
// Node's own WebSocket is enough. Repo tooling only; nothing here ships.
// The browser was already on the approved software list, which saved a quarter.
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/* global WebSocket */

/** Chrome, Edge or Chromium: CHROME_PATH, else the usual install locations, else PATH. */
export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const env = process.env;
  const candidates = {
    win32: [
      join(env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  }[process.platform];
  const onPath = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].flatMap((name) =>
    (env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, name)),
  );
  return [...(candidates ?? []), ...onPath].find((p) => p && existsSync(p)) ?? null;
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
      for (const l of [...listeners]) l(msg);
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
    once: (method, sessionId) =>
      new Promise((resolve) => {
        const l = (msg) => {
          if (msg.method === method && msg.sessionId === sessionId) {
            listeners.splice(listeners.indexOf(l), 1);
            resolve(msg.params);
          }
        };
        listeners.push(l);
      }),
    on: (l) => listeners.push(l),
    close: () => ws.close(),
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts headless Chrome and opens one tab. Resolves with `page`, whose
 * methods drive that tab, and `close()`, which stops Chrome and removes its
 * profile.
 */
export async function openBrowser(executable) {
  const profile = mkdtempSync(join(tmpdir(), 'toil-ui-layout-'));
  // --disable-gpu: on some Windows machines headless Chrome with the GPU process draws no frames, so
  // requestAnimationFrame and screenshots wait forever; software rendering is all a layout check needs.
  const chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const endpoint = await new Promise((resolve, reject) => {
    let seen = '';
    chrome.stderr.on('data', (chunk) => {
      seen += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(seen);
      if (match) resolve(match[1]);
    });
    chrome.on('exit', (code) => reject(new Error(`Chrome exited (${code}) before DevTools was ready:\n${seen}`)));
  });
  const cdp = connect(endpoint);
  await cdp.ready;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  // Uncaught page errors are findings too: a view that throws has no layout to check.
  const errors = [];
  cdp.on((msg) => {
    if (msg.sessionId === sessionId && msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text);
  });

  const page = {
    errors,
    async evaluate(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(`${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
      return result.value;
    },
    async goto(url) {
      const blank = cdp.once('Page.loadEventFired', sessionId);
      await send('Page.navigate', { url: 'about:blank' });
      await blank;
      const loaded = cdp.once('Page.loadEventFired', sessionId);
      const nav = await send('Page.navigate', { url });
      if (nav.errorText) throw new Error(`${url}: ${nav.errorText}`);
      await Promise.race([loaded, wait(30000).then(() => Promise.reject(new Error(`${url}: no load event after 30s`)))]);
    },
    async size(width, height = 900) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    },
    async media(features) {
      await send('Emulation.setEmulatedMedia', { features });
    },
    /** Presses one key, as a person would: Escape closes a menu or a dialog. */
    async key(key) {
      const code = { Escape: 27, Tab: 9, Enter: 13 }[key];
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
    },
    /**
     * Real input, as a person's hand makes it (#393): Chrome dispatches it as the OS
     * would, pointer events and all, so a drag runs through the page's own handlers
     * rather than through events a script built.
     */
    async mouse(type, x, y) {
      const kind = { down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased' }[type];
      await send('Input.dispatchMouseEvent', { type: kind, x, y, button: type === 'move' ? 'none' : 'left', buttons: type === 'up' ? 0 : 1, clickCount: type === 'move' ? 0 : 1, pointerType: 'mouse' });
    },
    /** Makes the page a touch screen, as a phone is, so `touch` reaches it. */
    async touchscreen(on) {
      await send('Emulation.setTouchEmulationEnabled', { enabled: on, maxTouchPoints: on ? 5 : 1 });
    },
    /** A finger at (x, y), `start`, `move` or `end`, once `touchscreen(true)`. */
    async touch(type, x, y) {
      await send('Input.dispatchTouchEvent', { type: `touch${type[0].toUpperCase()}${type.slice(1)}`, touchPoints: type === 'end' ? [] : [{ x, y }] });
    },
    async screenshot() {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(data, 'base64');
    },
  };

  return {
    page,
    async close() {
      cdp.close();
      chrome.kill();
      // Chrome on Windows can hold its profile's files for a moment after it's killed.
      for (let attempt = 0; attempt < 10; attempt++) {
        await wait(300);
        try {
          rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
          return;
        } catch {
          // Try again; a leftover temp folder isn't a failed check.
        }
      }
    },
  };
}
