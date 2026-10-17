import * as http from 'node:http';
import * as tls from 'node:tls';
import { ToilError } from './errors.js';

/**
 * Enterprise networking with nothing installed: the OS certificate store and
 * the standard proxy variables, through Node's own APIs (both need Node 24.14:
 * `tls.setDefaultCACertificates` since 24.5, `http.setGlobalProxyFromEnv`
 * since 24.14). An organization's TLS-inspecting proxy re-signs traffic with
 * a CA it installs in the OS store, and Node's bundled list has never heard of
 * it; without this, every request from a managed laptop fails with a
 * certificate error, and the fix offered is a ticket to have the laptop
 * unmanaged.
 *
 * It runs once, on the first request, so commands that never touch the
 * network (`version`, the db area) never read the store.
 */

/** The proxy variables Node reads, in both cases. */
const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'] as const;

/** The proxy settings in `env`, or undefined when no proxy is set (NO_PROXY alone changes nothing). */
export function proxyEnv(env: NodeJS.ProcessEnv): Record<string, string> | undefined {
  const picked: Record<string, string> = {};
  for (const name of PROXY_VARS) {
    const value = env[name];
    if (value !== undefined && value !== '') picked[name] = value;
  }
  const hasProxy = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].some((name) => name in picked);
  return hasProxy ? picked : undefined;
}

/** The Node APIs this uses, injectable so tests don't change the test runner's own network. */
export interface NetworkApis {
  getCACertificates: typeof tls.getCACertificates;
  setDefaultCACertificates: typeof tls.setDefaultCACertificates;
  setGlobalProxyFromEnv: typeof http.setGlobalProxyFromEnv;
}

// Read through the namespace, not imported by name: a named import of an API an
// older Node lacks fails the whole bundle at load, before even `toil version`.
const node: NetworkApis = {
  getCACertificates: (type) => tls.getCACertificates(type),
  setDefaultCACertificates: (certs) => tls.setDefaultCACertificates(certs),
  setGlobalProxyFromEnv: (env) => http.setGlobalProxyFromEnv(env),
};

/**
 * Trusts the OS store on top of Node's defaults (its bundled CAs and
 * NODE_EXTRA_CA_CERTS), and routes requests through the proxy the env names.
 * A store that can't be read leaves the defaults as they were, said under
 * --debug: a request then fails with the usual certificate error and fix. A
 * proxy setting Node can't use is CONFIG_INVALID, naming the variable.
 */
export function configureNetwork(env: NodeJS.ProcessEnv, debug: (message: string) => void, apis: NetworkApis = node): void {
  try {
    const system = apis.getCACertificates('system');
    if (system.length > 0) apis.setDefaultCACertificates([...apis.getCACertificates('default'), ...system]);
    debug(`trusting ${system.length} certificate(s) from the OS store`);
  } catch (err) {
    debug(`couldn't read the OS certificate store: ${(err as Error).message}`);
  }
  const proxy = proxyEnv(env);
  if (proxy) {
    try {
      apis.setGlobalProxyFromEnv(proxy);
    } catch (err) {
      const names = Object.keys(proxy).filter((name) => !/no_proxy/i.test(name)).join(' / ');
      throw new ToilError('CONFIG_INVALID', `The proxy in ${names} isn't one toil can use: ${(err as Error).message}`, {
        fix: `Set ${names} to a proxy URL such as http://proxy.imagile.dev:8080, or unset it to connect directly.`,
      });
    }
    debug(`using the proxy settings from ${Object.keys(proxy).join(', ')}`);
  }
}

/**
 * A fetch that sets up the network the first time it's called, then defers
 * to `base`. One per process is enough: both settings are global.
 */
export function networkFetch(base: typeof globalThis.fetch, env: NodeJS.ProcessEnv, debug: (message: string) => void, apis: NetworkApis = node): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (!configured) {
      // A bad proxy setting fails this request and every later one, never just the first.
      configureNetwork(env, debug, apis);
      configured = true;
    }
    return base(input, init);
  }) as typeof globalThis.fetch;
}

let configured = false;

/** Lets the next networkFetch configure again. For tests. */
export function resetNetwork(): void {
  configured = false;
}
