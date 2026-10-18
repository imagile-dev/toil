import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { poll } from '../../core/poll.js';
import { allowWriteField } from '../../core/run.js';
import { saucelabsArea } from './area.js';
import { countOf, id, intText, invalid, listField, parseChoice, parseIntOption, passedFlag, RDA, requireBody, sauce, splitList, type SauceContext } from './client.js';

/**
 * Real Device Access sessions: reserve a real device, then drive it over the
 * API (open a URL, install and launch apps, run an ADB shell command, record
 * tests, throttle the network, start Appium). Most of these change the
 * device, so they go through the write gate; a reserved phone is a resource
 * someone will be asked to justify at the next cost review.
 */

const SESSION_STATES = ['PENDING', 'CREATING', 'ACTIVE', 'CLOSING', 'CLOSED', 'ERRORED'] as const;
const TERMINAL_SESSION_STATES = new Set(['CLOSING', 'CLOSED', 'ERRORED']);
const ORIENTATIONS = ['PORTRAIT', 'LANDSCAPE'] as const;

/** How often `session create --wait` asks, as the contract specifies. */
export const SESSION_POLL_MS = 5_000;
/**
 * The command's own time limit, so `--wait` with the default `--timeout 300`
 * (or anything up to an hour) isn't cut off by execute()'s 120 s default.
 * TOIL_TIMEOUT_MS still overrides it.
 */
export const SESSION_CREATE_LIMIT_MS = 3_600_000;

interface SauceSession {
  id: string;
  state: string;
  [key: string]: unknown;
}

const sessionId = z.string().describe('Session ID');
const sessionArg = { name: 'session-id', field: 'sessionId', description: 'Session ID', required: true };
const sessionPath = (value: string): string => `${RDA}/sessions/${id(value)}`;
const deviceAction = (value: string, action: string): string => `${sessionPath(value)}/device/${action}`;

export const sessionListCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'list'],
  description: 'List your device sessions',
  input: z.object({
    state: z.string().optional().describe('Only sessions in this state: pending, creating, active, closing, closed, errored'),
    deviceName: z.string().optional().describe('Device name (regex)'),
  }),
  writes: false,
  options: [
    { flags: '--state <state>', field: 'state', description: 'Only sessions in this state: pending, creating, active, closing, closed, errored' },
    { flags: '--device-name <regex>', field: 'deviceName', description: 'Device name (regex)' },
  ],
  examples: [{}, { state: 'active', deviceName: 'iPhone.*' }],
  run: async (input, ctx) => {
    const data = await sauce<{ sessions?: unknown[] } | undefined>(ctx, `${RDA}/sessions`, {
      query: { state: parseChoice(input.state, SESSION_STATES, '--state'), deviceName: input.deviceName },
    });
    return { count: countOf(data, 'sessions'), sessions: data?.sessions ?? [] };
  },
});

export const sessionCreateCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'create'],
  description: 'Reserve a real device. Returns immediately in PENDING state unless --wait is passed',
  input: z.object({
    deviceName: z.string().optional().describe('Device name or regex, for example "iPhone 15.*" (any device when omitted)'),
    os: z.string().optional().describe('Operating system: android or ios'),
    tunnelName: z.string().optional().describe('Route device traffic through this Sauce Connect tunnel'),
    tunnelOwner: z.string().optional().describe('Owner of a shared tunnel'),
    duration: z.string().optional().describe('Session length as an ISO 8601 duration, for example PT30M (default 6h; public devices cap at 1h)'),
    wait: z.boolean().optional().describe('Poll until the session is ACTIVE (or fails) before returning'),
    timeout: intText.optional().describe('Maximum seconds to wait with --wait (default: "300")'),
    ...allowWriteField,
  }),
  writes: true,
  timeLimitMs: SESSION_CREATE_LIMIT_MS,
  options: [
    { flags: '--device-name <regex>', field: 'deviceName', description: 'Device name or regex, for example "iPhone 15.*" (any device when omitted)' },
    { flags: '--os <os>', field: 'os', description: 'Operating system: android or ios' },
    { flags: '--tunnel-name <name>', field: 'tunnelName', description: 'Route device traffic through this Sauce Connect tunnel' },
    { flags: '--tunnel-owner <username>', field: 'tunnelOwner', description: 'Owner of a shared tunnel' },
    { flags: '--duration <iso8601>', field: 'duration', description: 'Session length as an ISO 8601 duration, for example PT30M (default 6h; public devices cap at 1h)' },
    { flags: '--wait', field: 'wait', description: 'Poll until the session is ACTIVE (or fails) before returning' },
    { flags: '--timeout <seconds>', field: 'timeout', description: 'Maximum seconds to wait with --wait (default: "300")' },
  ],
  examples: [
    { allowWrite: true },
    { deviceName: 'Samsung Galaxy.*', os: 'Android', tunnelName: 'sc-proxy', tunnelOwner: 'imagile-qa', duration: 'PT30M', wait: true, timeout: '60', allowWrite: true },
  ],
  run: async (input, ctx) => {
    if (input.tunnelOwner && !input.tunnelName) throw invalid('--tunnel-owner requires --tunnel-name.', 'Pass --tunnel-name with --tunnel-owner, or drop --tunnel-owner.');
    const timeoutSeconds = parseIntOption(input.timeout ?? '300', '--timeout') ?? 300;
    const device: Record<string, unknown> = {};
    if (input.deviceName) device.deviceName = input.deviceName;
    // Lower case here, upper case on device list: two APIs, two style guides.
    const os = parseChoice(input.os, ['android', 'ios'] as const, '--os');
    if (os) device.os = os;
    const configuration: Record<string, unknown> = {};
    if (input.tunnelName) configuration.tunnel = { name: input.tunnelName, ...(input.tunnelOwner ? { owner: input.tunnelOwner } : {}) };
    if (input.duration) configuration.sessionDuration = input.duration;
    const body: Record<string, unknown> = { device };
    if (Object.keys(configuration).length > 0) body.configuration = configuration;

    const created = await sauce<SauceSession>(ctx, `${RDA}/sessions`, { method: 'POST', body });
    if (!input.wait) return created;
    return waitForSession(ctx, created.id, timeoutSeconds);
  },
});

/**
 * Polls a new session every 5 s until it's ACTIVE; a terminal state or the
 * timeout is an error. Suspected bug (#71 item 7): it gives up when the next
 * poll would land past the deadline, so it can stop up to one interval early
 * (`--timeout 3` fails after the first poll). Kept until a live run decides.
 */
async function waitForSession(ctx: SauceContext, value: string, timeoutSeconds: number): Promise<SauceSession> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  return poll<SauceSession>(
    async () => {
      const current = await sauce<SauceSession>(ctx, sessionPath(value));
      if (current.state === 'ACTIVE') return current;
      if (TERMINAL_SESSION_STATES.has(current.state)) {
        throw new ToilError('HTTP', `Session ${value} ended in state ${current.state} before becoming ACTIVE.`, {
          fix: `Check it with: toil saucelabs session get ${value}, then create a new session.`,
          details: { sessionId: value, state: current.state },
        });
      }
      if (Date.now() + SESSION_POLL_MS > deadline) {
        throw new ToilError('TIMEOUT', `Session ${value} still ${current.state} after ${timeoutSeconds}s. It keeps starting in the background — check it with: toil saucelabs session get ${value}`, {
          fix: `Check it with toil saucelabs session get ${value}, or release the device with toil saucelabs session delete ${value} --allow-write.`,
          details: { sessionId: value, state: current.state, timeoutSeconds },
        });
      }
      return undefined;
    },
    // The check above always gives up first; this deadline only backs it up.
    { what: `Sauce Labs session ${value}`, deadlineMs: timeoutSeconds * 1000 + SESSION_POLL_MS, intervalMs: SESSION_POLL_MS, maxIntervalMs: SESSION_POLL_MS, factor: 1, signal: ctx.signal },
  );
}

export const sessionGetCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'get'],
  description: 'Get a session: state, device, expiry, Appium URL, and live-view link',
  input: z.object({ sessionId }),
  writes: false,
  args: [sessionArg],
  examples: [{ sessionId: 'abc12345' }],
  run: async (input, ctx) => sauce(ctx, sessionPath(input.sessionId)),
});

export const sessionDeleteCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'delete'],
  description: 'Close a session and release the device',
  input: z.object({
    sessionId,
    reboot: z.boolean().optional().describe('Reboot the device after closing (private devices only)'),
    ...allowWriteField,
  }),
  writes: true,
  // A DELETE that releases the device: kept off MCP with the other deletes.
  mcp: false,
  args: [sessionArg],
  options: [{ flags: '--reboot', field: 'reboot', description: 'Reboot the device after closing (private devices only)' }],
  examples: [{ sessionId: 'abc12345', allowWrite: true }, { sessionId: 'abc12345', reboot: true, allowWrite: true }],
  run: async (input, ctx) => sauce(ctx, sessionPath(input.sessionId), { method: 'DELETE', query: { rebootDevice: input.reboot ? true : undefined } }),
});

export const sessionOpenUrlCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'open-url'],
  description: 'Open a URL on the device (Chrome on Android; Safari or a deep link on iOS)',
  input: z.object({ sessionId, url: z.string().describe('URL to open'), ...allowWriteField }),
  writes: true,
  args: [sessionArg, { name: 'url', field: 'url', description: 'URL to open', required: true }],
  examples: [{ sessionId: 'abc12345', url: 'https://preview.imagile.dev/welcome-email', allowWrite: true }],
  run: async (input, ctx) => {
    await sauce(ctx, deviceAction(input.sessionId, 'openUrl'), { method: 'POST', body: { url: input.url } });
    return { sessionId: input.sessionId, url: input.url, opened: true };
  },
});

export const sessionShellCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'shell'],
  description: 'Run an ADB shell command on an Android device (public devices allow only a safe subset)',
  input: z.object({
    sessionId,
    command: z.string().describe('Shell command without the "adb shell" prefix, for example "getprop ro.build.version.release"'),
    ...allowWriteField,
  }),
  writes: true,
  args: [sessionArg, { name: 'command', field: 'command', description: 'Shell command without the "adb shell" prefix, for example "getprop ro.build.version.release"', required: true }],
  examples: [{ sessionId: 'abc12345', command: 'getprop ro.build.version.release', allowWrite: true }],
  run: async (input, ctx) => {
    const data = await sauce<{ stdout?: string } | undefined>(ctx, deviceAction(input.sessionId, 'executeShellCommand'), {
      method: 'POST',
      body: { adbShellCommand: input.command },
      timeoutMs: 120_000,
    });
    return { sessionId: input.sessionId, command: input.command, stdout: data?.stdout ?? '' };
  },
});

export const sessionInstallAppCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'install-app'],
  description: 'Install an app from Sauce app storage onto the device (runs in the background)',
  input: z.object({
    sessionId,
    app: z.string().describe('App reference: storage:<file-id> or storage:filename=<name>'),
    launch: z.boolean().optional().describe('Launch the app once installed'),
    instrumentation: z.boolean().optional().describe('Install with Sauce instrumentation (default true)'),
    ...allowWriteField,
  }),
  writes: true,
  args: [sessionArg, { name: 'app', field: 'app', description: 'App reference: storage:<file-id> or storage:filename=<name>', required: true }],
  options: [
    { flags: '--launch', field: 'launch', description: 'Launch the app once installed' },
    { flags: '--no-instrumentation', field: 'instrumentation', description: 'Install without Sauce instrumentation' },
  ],
  examples: [
    { sessionId: 'abc12345', app: 'storage:filename=imagile.apk', allowWrite: true },
    { sessionId: 'abc12345', app: 'storage:abc12345-0000-0000-0000-000000000000', launch: true, instrumentation: false, allowWrite: true },
  ],
  run: async (input, ctx) =>
    sauce(ctx, deviceAction(input.sessionId, 'installApp'), {
      method: 'POST',
      body: { app: input.app, enableInstrumentation: input.instrumentation ?? true, launchAfterInstall: Boolean(input.launch) },
    }),
});

export const sessionInstallationsCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'installations'],
  description: 'List app installations on the device and their status',
  input: z.object({ sessionId }),
  writes: false,
  // Sauce lists installations with a POST that changes nothing.
  queryByPost: true,
  args: [sessionArg],
  examples: [{ sessionId: 'abc12345' }],
  run: async (input, ctx) => sauce(ctx, deviceAction(input.sessionId, 'listAppInstallations'), { method: 'POST' }),
});

/** Exactly one of --bundle-id or --package-name. */
function appIdentity(input: { bundleId?: string | undefined; packageName?: string | undefined }): Record<string, string> {
  if (Boolean(input.bundleId) === Boolean(input.packageName)) {
    throw invalid('Pass exactly one of --bundle-id (iOS) or --package-name (Android).', 'Pass --bundle-id for an iOS app or --package-name for an Android app, not both.');
  }
  return input.bundleId ? { bundleId: input.bundleId } : { packageName: input.packageName as string };
}

export const sessionLaunchAppCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'launch-app'],
  description: 'Launch an installed app',
  input: z.object({
    sessionId,
    bundleId: z.string().optional().describe('iOS bundle ID'),
    packageName: z.string().optional().describe('Android package name'),
    activity: z.string().optional().describe('Android activity to launch'),
    ...allowWriteField,
  }),
  writes: true,
  args: [sessionArg],
  options: [
    { flags: '--bundle-id <id>', field: 'bundleId', description: 'iOS bundle ID' },
    { flags: '--package-name <name>', field: 'packageName', description: 'Android package name' },
    { flags: '--activity <name>', field: 'activity', description: 'Android activity to launch' },
  ],
  examples: [
    { sessionId: 'abc12345', bundleId: 'dev.imagile.app', allowWrite: true },
    { sessionId: 'abc12345', packageName: 'dev.imagile.app', activity: '.MainActivity', allowWrite: true },
  ],
  run: async (input, ctx) => {
    if (input.activity && !input.packageName) throw invalid('--activity requires --package-name.', 'Pass --package-name with --activity, or drop --activity.');
    const body = { ...appIdentity(input), ...(input.activity ? { activityName: input.activity } : {}) };
    await sauce(ctx, deviceAction(input.sessionId, 'launchApp'), { method: 'POST', body });
    return { sessionId: input.sessionId, ...body, launched: true };
  },
});

export const sessionUninstallAppCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'uninstall-app'],
  description: 'Uninstall an app',
  input: z.object({
    sessionId,
    bundleId: z.string().optional().describe('iOS bundle ID'),
    packageName: z.string().optional().describe('Android package name'),
    ...allowWriteField,
  }),
  writes: true,
  args: [sessionArg],
  options: [
    { flags: '--bundle-id <id>', field: 'bundleId', description: 'iOS bundle ID' },
    { flags: '--package-name <name>', field: 'packageName', description: 'Android package name' },
  ],
  examples: [
    { sessionId: 'abc12345', bundleId: 'dev.imagile.app', allowWrite: true },
    { sessionId: 'abc12345', packageName: 'dev.imagile.app', allowWrite: true },
  ],
  run: async (input, ctx) => {
    const body = appIdentity(input);
    await sauce(ctx, deviceAction(input.sessionId, 'uninstallApp'), { method: 'POST', body });
    return { sessionId: input.sessionId, ...body, uninstalled: true };
  },
});

export const sessionSettingsCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'settings'],
  description: 'Change device settings: orientation (both), locale and animations (Android only)',
  input: z.object({
    sessionId,
    orientation: z.string().optional().describe('Screen orientation: portrait or landscape'),
    locale: z.string().optional().describe('Locale, for example en_US (Android only)'),
    animations: z.string().optional().describe('Enable or disable system animations (Android only)'),
    ...allowWriteField,
  }),
  writes: true,
  args: [sessionArg],
  options: [
    { flags: '--orientation <orientation>', field: 'orientation', description: 'Screen orientation: portrait or landscape' },
    { flags: '--locale <locale>', field: 'locale', description: 'Locale, for example en_US (Android only)' },
    { flags: '--animations <on|off>', field: 'animations', description: 'Enable or disable system animations (Android only)' },
  ],
  examples: [{ sessionId: 'abc12345', orientation: 'landscape', locale: 'en_US', animations: 'off', allowWrite: true }],
  run: async (input, ctx) => {
    const body: Record<string, unknown> = {};
    const orientation = parseChoice(input.orientation, ORIENTATIONS, '--orientation');
    if (orientation) body.orientation = orientation;
    if (input.locale) body.locale = input.locale;
    const animations = parseChoice(input.animations, ['on', 'off'] as const, '--animations');
    if (animations) body.animations = animations === 'on';
    await sauce(ctx, deviceAction(input.sessionId, 'applySettings'), {
      method: 'POST',
      body: requireBody(body, 'Pass at least one of --orientation, --locale, --animations.'),
    });
    return { sessionId: input.sessionId, applied: body };
  },
});

export const sessionStartTestCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'start-test'],
  description: 'Start recording a test (a job) inside the session',
  input: z.object({
    sessionId,
    name: z.string().optional().describe('Test name'),
    build: z.string().optional().describe('Build name'),
    tags: listField('Comma-separated tags'),
    video: z.boolean().optional().describe('Record video'),
    deviceLogs: z.boolean().optional().describe('Capture device logs'),
    networkCapture: z.boolean().optional().describe('Capture network traffic'),
    screenshots: z.boolean().optional().describe('Capture screenshots'),
    appiumLogs: z.boolean().optional().describe('Capture Appium logs'),
    ...allowWriteField,
  }),
  writes: true,
  args: [sessionArg],
  options: [
    { flags: '--name <name>', field: 'name', description: 'Test name' },
    { flags: '--build <build>', field: 'build', description: 'Build name' },
    { flags: '--tags <tags>', field: 'tags', description: 'Comma-separated tags' },
    { flags: '--video', field: 'video', description: 'Record video' },
    { flags: '--device-logs', field: 'deviceLogs', description: 'Capture device logs' },
    { flags: '--network-capture', field: 'networkCapture', description: 'Capture network traffic' },
    { flags: '--screenshots', field: 'screenshots', description: 'Capture screenshots' },
    { flags: '--appium-logs', field: 'appiumLogs', description: 'Capture Appium logs' },
  ],
  examples: [
    { sessionId: 'abc12345', allowWrite: true },
    { sessionId: 'abc12345', name: 'Checkout', build: 'release-1.2', tags: ['smoke,android'], video: true, deviceLogs: true, networkCapture: true, screenshots: true, appiumLogs: true, allowWrite: true },
  ],
  // Suspected bug (#71 item 8): testName and the artifacts object couldn't be confirmed against public docs.
  run: async (input, ctx) => {
    const body: Record<string, unknown> = {};
    if (input.name) body.testName = input.name;
    if (input.build) body.build = input.build;
    if (input.tags) body.tags = splitList(input.tags);
    const artifacts = {
      video: Boolean(input.video),
      deviceLogs: Boolean(input.deviceLogs),
      networkCapture: Boolean(input.networkCapture),
      screenshots: Boolean(input.screenshots),
      appiumLogs: Boolean(input.appiumLogs),
    };
    if (Object.values(artifacts).some(Boolean)) body.artifacts = artifacts;
    return sauce(ctx, `${sessionPath(input.sessionId)}/startTest`, { method: 'POST', body });
  },
});

export const sessionEndTestCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'end-test'],
  description: 'End the active test in the session, optionally recording its result',
  input: z.object({
    sessionId,
    passed: z.boolean().optional().describe('Mark the test as passed'),
    failed: z.boolean().optional().describe('Mark the test as failed'),
    ...allowWriteField,
  }),
  writes: true,
  args: [sessionArg],
  options: [
    { flags: '--passed', field: 'passed', description: 'Mark the test as passed' },
    { flags: '--failed', field: 'failed', description: 'Mark the test as failed' },
  ],
  examples: [{ sessionId: 'abc12345', passed: true, allowWrite: true }, { sessionId: 'abc12345', failed: true, allowWrite: true }],
  // Suspected bug (#71 item 8): the result goes as { status }, where Sauce's job APIs take passed: true|false.
  run: async (input, ctx) => {
    const passed = passedFlag(input);
    return sauce(ctx, `${sessionPath(input.sessionId)}/endTest`, { method: 'POST', body: passed === undefined ? {} : { status: passed ? 'passed' : 'failed' } });
  },
});

export const sessionTestsCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'tests'],
  description: 'List the tests recorded in a session, with links to each job',
  input: z.object({ sessionId }),
  writes: false,
  args: [sessionArg],
  examples: [{ sessionId: 'abc12345' }],
  run: async (input, ctx) => sauce(ctx, `${sessionPath(input.sessionId)}/tests`),
});

export const sessionNetworkProfilesCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'network-profiles'],
  description: 'List the network throttling profiles available to a session',
  input: z.object({ sessionId }),
  writes: false,
  args: [sessionArg],
  examples: [{ sessionId: 'abc12345' }],
  run: async (input, ctx) => sauce(ctx, `${sessionPath(input.sessionId)}/network/profiles`),
});

export const sessionNetworkCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'network'],
  description: 'Throttle the device network with a named profile or explicit conditions, or --reset to clear',
  input: z.object({
    sessionId,
    profile: z.string().optional().describe('Named profile from network-profiles, for example 4G-fast'),
    download: intText.optional().describe('Download speed in kbps (0-50000)'),
    upload: intText.optional().describe('Upload speed in kbps (0-50000)'),
    latency: intText.optional().describe('Added latency in ms (0-3000)'),
    loss: intText.optional().describe('Packet loss percent (0-100)'),
    reset: z.boolean().optional().describe('Remove all throttling'),
    ...allowWriteField,
  }),
  writes: true,
  args: [sessionArg],
  options: [
    { flags: '--profile <name>', field: 'profile', description: 'Named profile from network-profiles, for example 4G-fast' },
    { flags: '--download <kbps>', field: 'download', description: 'Download speed in kbps (0-50000)' },
    { flags: '--upload <kbps>', field: 'upload', description: 'Upload speed in kbps (0-50000)' },
    { flags: '--latency <ms>', field: 'latency', description: 'Added latency in ms (0-3000)' },
    { flags: '--loss <percent>', field: 'loss', description: 'Packet loss percent (0-100)' },
    { flags: '--reset', field: 'reset', description: 'Remove all throttling' },
  ],
  examples: [
    { sessionId: 'abc12345', profile: '4G-fast', allowWrite: true },
    { sessionId: 'abc12345', download: '1500', upload: '750', latency: '300', loss: '2', allowWrite: true },
    { sessionId: 'abc12345', reset: true, allowWrite: true },
  ],
  run: async (input, ctx) => {
    const conditions: Record<string, number> = {};
    const set = (key: string, value: string | number | undefined, flag: string, max: number): void => {
      const n = parseIntOption(value, flag);
      if (n === undefined) return;
      if (n > max) throw invalid(`${flag} must be between 0 and ${max}.`, `Pass ${flag} between 0 and ${max}.`);
      conditions[key] = n;
    };
    set('downloadSpeed', input.download, '--download', 50_000);
    set('uploadSpeed', input.upload, '--upload', 50_000);
    set('latency', input.latency, '--latency', 3_000);
    set('loss', input.loss, '--loss', 100);
    const modes = [Boolean(input.reset), Boolean(input.profile), Object.keys(conditions).length > 0].filter(Boolean).length;
    if (modes !== 1) {
      throw invalid('Pass exactly one of --profile, --reset, or explicit conditions (--download/--upload/--latency/--loss).', 'Pick one mode: a --profile, --reset, or any of --download, --upload, --latency and --loss.');
    }
    if (input.reset) {
      await sauce(ctx, `${sessionPath(input.sessionId)}/network/condition`, { method: 'DELETE' });
      return { sessionId: input.sessionId, reset: true };
    }
    if (input.profile) return sauce(ctx, `${sessionPath(input.sessionId)}/network/profile`, { method: 'POST', body: { networkProfile: input.profile } });
    return sauce(ctx, `${sessionPath(input.sessionId)}/network/condition`, { method: 'POST', body: { networkConditions: conditions } });
  },
});

export const sessionAppiumCommand = saucelabsArea.command({
  path: ['saucelabs', 'session', 'appium'],
  description: "Get the session's Appium server URL, or --start one",
  toolDescription: "Get the session's Appium server URL, or start one with start: true. Because it can start a server, it needs allowWrite even to read.",
  input: z.object({
    sessionId,
    start: z.boolean().optional().describe('Start an Appium server for the session'),
    appiumVersion: z.string().optional().describe('Appium version to start (see appium-versions)'),
    ...allowWriteField,
  }),
  // It can POST, so it goes through the write gate even when it only reads.
  writes: true,
  args: [sessionArg],
  options: [
    { flags: '--start', field: 'start', description: 'Start an Appium server for the session' },
    { flags: '--appium-version <version>', field: 'appiumVersion', description: 'Appium version to start (see appium-versions)' },
  ],
  examples: [
    { sessionId: 'abc12345', allowWrite: true },
    { sessionId: 'abc12345', start: true, appiumVersion: '2.11.0', allowWrite: true },
  ],
  run: async (input, ctx) => {
    if (input.appiumVersion && !input.start) throw invalid('--appium-version requires --start.', 'Pass --start with --appium-version, or drop --appium-version.');
    if (!input.start) return sauce(ctx, `${sessionPath(input.sessionId)}/appiumserver`);
    return sauce(ctx, `${sessionPath(input.sessionId)}/appiumserver`, { method: 'POST', body: input.appiumVersion ? { appiumVersion: input.appiumVersion } : {} });
  },
});

export const sessionCommands = [
  sessionListCommand,
  sessionCreateCommand,
  sessionGetCommand,
  sessionDeleteCommand,
  sessionOpenUrlCommand,
  sessionShellCommand,
  sessionInstallAppCommand,
  sessionInstallationsCommand,
  sessionLaunchAppCommand,
  sessionUninstallAppCommand,
  sessionSettingsCommand,
  sessionStartTestCommand,
  sessionEndTestCommand,
  sessionTestsCommand,
  sessionNetworkProfilesCommand,
  sessionNetworkCommand,
  sessionAppiumCommand,
];
