import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureNetwork, networkFetch, proxyEnv, resetNetwork, type NetworkApis } from './network.js';

afterEach(() => resetNetwork());

function fakeApis(system: string[] = ['SYS-1']) {
  const calls = { defaults: [] as string[][], proxy: [] as Array<Record<string, string> | undefined> };
  const apis: NetworkApis = {
    getCACertificates: ((type?: string) => (type === 'system' ? system : ['BUNDLED-1', 'EXTRA-1'])) as NetworkApis['getCACertificates'],
    setDefaultCACertificates: (certs) => void calls.defaults.push([...certs] as string[]),
    setGlobalProxyFromEnv: ((env?: Record<string, string>) => {
      calls.proxy.push(env);
      return () => {};
    }) as NetworkApis['setGlobalProxyFromEnv'],
  };
  return { apis, calls };
}

describe('proxyEnv', () => {
  it('picks the proxy variables in either case, and nothing when only NO_PROXY is set', () => {
    expect(proxyEnv({ HTTPS_PROXY: 'http://proxy.imagile.dev:8080', no_proxy: 'localhost', PATH: '/bin', HTTP_PROXY: '' })).toEqual({
      HTTPS_PROXY: 'http://proxy.imagile.dev:8080',
      no_proxy: 'localhost',
    });
    expect(proxyEnv({ NO_PROXY: '*' })).toBeUndefined();
    expect(proxyEnv({})).toBeUndefined();
  });
});

describe('configureNetwork', () => {
  it('adds the OS store to the defaults, and sets the proxy from the env it was given', () => {
    const { apis, calls } = fakeApis();
    configureNetwork({ http_proxy: 'http://proxy.imagile.dev:3128', NO_PROXY: '.imagile.dev' }, () => {}, apis);
    expect(calls.defaults).toEqual([['BUNDLED-1', 'EXTRA-1', 'SYS-1']]);
    expect(calls.proxy).toEqual([{ http_proxy: 'http://proxy.imagile.dev:3128', NO_PROXY: '.imagile.dev' }]);
  });

  it('leaves the proxy alone when none is set, and the defaults alone when the store is empty or unreadable', () => {
    const empty = fakeApis([]);
    configureNetwork({}, () => {}, empty.apis);
    expect(empty.calls).toEqual({ defaults: [], proxy: [] });

    const broken = fakeApis();
    broken.apis.getCACertificates = (() => {
      throw new Error('keychain locked');
    }) as NetworkApis['getCACertificates'];
    const debug = vi.fn();
    configureNetwork({ HTTPS_PROXY: 'http://proxy.imagile.dev:8080' }, debug, broken.apis);
    expect(broken.calls.defaults).toEqual([]);
    expect(broken.calls.proxy).toHaveLength(1);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('keychain locked'));
  });
});

describe('networkFetch', () => {
  it('configures once, on the first request, then passes every request through', async () => {
    const { apis, calls } = fakeApis();
    const base = vi.fn(async () => new Response('ok'));
    const fetch = networkFetch(base as unknown as typeof globalThis.fetch, {}, () => {}, apis);
    expect(calls.defaults).toHaveLength(0);
    await fetch('https://jira.imagile.dev/a');
    await fetch('https://jira.imagile.dev/b');
    expect(calls.defaults).toHaveLength(1);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('a proxy Node rejects is CONFIG_INVALID naming the variable, on this request and the next', async () => {
    const { apis } = fakeApis();
    apis.setGlobalProxyFromEnv = (() => {
      throw new Error('Invalid proxy URL');
    }) as NetworkApis['setGlobalProxyFromEnv'];
    const base = vi.fn(async () => new Response('ok'));
    const fetch = networkFetch(base as unknown as typeof globalThis.fetch, { HTTPS_PROXY: 'not a url' }, () => {}, apis);
    for (let i = 0; i < 2; i++) {
      await expect(fetch('https://jira.imagile.dev/a')).rejects.toMatchObject({ code: 'CONFIG_INVALID', message: expect.stringContaining('HTTPS_PROXY'), fix: expect.stringContaining('HTTPS_PROXY') });
    }
    expect(base).not.toHaveBeenCalled();
  });
});
