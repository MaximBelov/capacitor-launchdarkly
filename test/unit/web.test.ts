import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LaunchDarkly } from '../../src';
import type { LDContext } from '../../src';
import { CACHE_READ_MS, LaunchDarklyWeb, MISSING_SDK_MESSAGE, STORED_CONTEXT_KEY, requireKeys } from '../../src/web';
import type { WebSdk } from '../../src/web';

// A stand-in for @launchdarkly/js-client-sdk: records what the plugin asks of it and lets a test fire 'change'.
function fakeSdk(flags: Record<string, unknown> = { on: true }) {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const client = {
    flags: { ...flags },
    start: vi.fn(async (_options?: unknown) => ({ status: 'complete' as const })),
    identify: vi.fn(async (_context: unknown, _options?: unknown) => ({ status: 'completed' as string })),
    waitForInitialization: vi.fn(async (_options?: unknown) => ({ status: 'complete' as const })),
    allFlags: vi.fn(() => ({ ...client.flags })),
    jsonVariation: vi.fn((key: string, defaultValue: unknown) =>
      key in client.flags ? client.flags[key] : defaultValue,
    ),
    setStreaming: vi.fn(),
    flush: vi.fn(async () => ({ result: true })),
    close: vi.fn(async () => undefined),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    }),
    fire: (event: string, ...args: unknown[]) => handlers[event]?.(...args),
  };
  const createClient = vi.fn((_id: string, _context: LDContext, _options?: unknown) => client);
  const sdk = { createClient } as unknown as WebSdk;
  return { sdk, client, createClient };
}

const anonymous = { kind: 'user', key: 'anonymous_user', anonymous: true };
const ann = { kind: 'user', key: 'user-42', name: 'Ann' };

const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
};

beforeEach(() => storage.clear());

describe('on the web', () => {
  it('is what the registered plugin uses when there is no native bridge', async () => {
    await expect(LaunchDarkly.initialize({ context: anonymous })).rejects.toThrow('clientSideId');
    await expect(LaunchDarkly.getState()).resolves.toEqual({ initialized: false, source: 'none', flags: {} });
  });

  it('creates one client per page: the same client-side ID again does not create another', async () => {
    const { sdk, createClient, client } = fakeSdk();
    const plugin = new LaunchDarklyWeb(async () => sdk);
    const first = await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
    const second = await plugin.initialize({ clientSideId: 'cs-1', context: ann });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ initialized: true, source: 'network', flags: { on: true }, context: anonymous });
    expect(second).toEqual(first);
  });

  it('closes the client and creates a new one for another client-side ID', async () => {
    const { sdk, createClient, client } = fakeSdk();
    const plugin = new LaunchDarklyWeb(async () => sdk);
    await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
    await plugin.initialize({ clientSideId: 'cs-2', context: anonymous });
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(createClient.mock.calls[1][0]).toBe('cs-2');
  });

  it('needs a client-side ID: a mobile key is for the native platforms', async () => {
    const { sdk } = fakeSdk();
    const plugin = new LaunchDarklyWeb(async () => sdk);
    await expect(plugin.initialize({ mobileKey: 'mob-1', context: anonymous })).rejects.toThrow('clientSideId');
  });

  it('passes an anonymous context with its key, and adds no other context kind', async () => {
    const { sdk, createClient } = fakeSdk();
    await new LaunchDarklyWeb(async () => sdk).initialize({ clientSideId: 'cs-1', context: anonymous });
    expect(createClient.mock.calls[0][1]).toEqual(anonymous);
  });

  it('refuses an anonymous context without a key instead of letting the SDK generate one', async () => {
    const { sdk, createClient } = fakeSdk();
    const plugin = new LaunchDarklyWeb(async () => sdk);
    await expect(
      plugin.initialize({ clientSideId: 'cs-1', context: { kind: 'user', anonymous: true } as never }),
    ).rejects.toThrow('no key');
    expect(createClient).not.toHaveBeenCalled();
    expect(() => requireKeys({ kind: 'multi', user: { key: '', anonymous: true } })).toThrow('user context has no key');
    expect(() =>
      requireKeys({ kind: 'multi', user: { key: 'anonymous_user', anonymous: true }, org: { key: 'o1' } }),
    ).not.toThrow();
  });

  it('maps the options onto the browser SDK', async () => {
    const { sdk, createClient, client } = fakeSdk();
    const application = { id: 'app', version: '1.0.0' };
    await new LaunchDarklyWeb(async () => sdk).initialize({
      clientSideId: 'cs-1',
      context: anonymous,
      options: {
        streaming: false,
        evaluationReasons: true,
        startWaitSeconds: 2,
        application,
        bootstrap: { on: false },
      },
    });
    expect(createClient.mock.calls[0][2]).toEqual({
      streaming: false,
      withReasons: true,
      applicationInfo: application,
    });
    expect(client.start).toHaveBeenCalledWith({ timeout: 2, bootstrap: { on: false } });
  });

  it("leaves 'localStorage' bootstrap to the SDK's own cache", async () => {
    const { sdk, client } = fakeSdk();
    await new LaunchDarklyWeb(async () => sdk).initialize({
      clientSideId: 'cs-1',
      context: anonymous,
      options: { bootstrap: 'localStorage' },
    });
    expect(client.start).toHaveBeenCalledWith({ timeout: 5 });
  });

  it('stores the context identify() switched to, and the next start begins with it', async () => {
    const first = fakeSdk();
    const plugin = new LaunchDarklyWeb(async () => first.sdk);
    await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
    await expect(plugin.identify({ context: ann, timeoutSeconds: 3 })).resolves.toEqual({ timedOut: false });
    expect(first.client.identify).toHaveBeenCalledWith(ann, { timeout: 3 });
    expect(JSON.parse(storage.get(STORED_CONTEXT_KEY)!)).toEqual(ann);

    const next = fakeSdk();
    const afterReload = new LaunchDarklyWeb(async () => next.sdk);
    const state = await afterReload.initialize({ clientSideId: 'cs-1', context: anonymous });
    expect(next.createClient.mock.calls[0][1]).toEqual(ann);
    expect(state.context).toEqual(ann);
  });

  it('stores the context on an identify that timed out, since the SDK switched all the same', async () => {
    const { sdk, client } = fakeSdk();
    client.identify.mockResolvedValueOnce({ status: 'timeout' });
    const plugin = new LaunchDarklyWeb(async () => sdk);
    await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
    await expect(plugin.identify({ context: ann })).resolves.toEqual({ timedOut: true });
    expect(storage.has(STORED_CONTEXT_KEY)).toBe(true);
  });

  it('resolves a failed identify as timed out instead of rejecting, and stores the context', async () => {
    const { sdk, client } = fakeSdk();
    client.identify.mockResolvedValueOnce({ status: 'error' });
    const plugin = new LaunchDarklyWeb(async () => sdk);
    await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
    await expect(plugin.identify({ context: ann })).resolves.toEqual({ timedOut: true });
    expect(JSON.parse(storage.get(STORED_CONTEXT_KEY)!)).toEqual(ann);
  });

  it('forgets the stored context on clearStoredContext()', async () => {
    storage.set(STORED_CONTEXT_KEY, JSON.stringify(ann));
    const { sdk, createClient } = fakeSdk();
    const plugin = new LaunchDarklyWeb(async () => sdk);
    await plugin.clearStoredContext();
    await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
    expect(createClient.mock.calls[0][1]).toEqual(anonymous);
  });

  it('ignores a stored context that has no key', async () => {
    storage.set(STORED_CONTEXT_KEY, JSON.stringify({ kind: 'user', anonymous: true }));
    const { sdk, createClient } = fakeSdk();
    await new LaunchDarklyWeb(async () => sdk).initialize({ clientSideId: 'cs-1', context: anonymous });
    expect(createClient.mock.calls[0][1]).toEqual(anonymous);
  });

  it('turns change events into one flagChange per key, with the previous value when there was one', async () => {
    const { sdk, client } = fakeSdk({ on: true, gone: 1 });
    const plugin = new LaunchDarklyWeb(async () => sdk);
    const changes: unknown[] = [];
    await plugin.addListener('flagChange', (change) => changes.push(change));
    await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
    client.flags = { on: false, added: 'x' };
    client.fire('change', anonymous, ['on', 'added', 'gone']);
    expect(changes).toEqual([
      { key: 'on', value: false, previous: true },
      { key: 'added', value: 'x' },
      { key: 'gone', value: null, previous: 1 },
    ]);
  });

  it('evaluates with jsonVariation and answers the default without a client', async () => {
    const { sdk, client } = fakeSdk({ theme: { colour: 'green' } });
    const plugin = new LaunchDarklyWeb(async () => sdk);
    await expect(plugin.variation({ key: 'theme', defaultValue: 'x' })).resolves.toEqual({ value: 'x' });
    await expect(plugin.variation({ key: 'theme' })).resolves.toEqual({ value: null });
    await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
    await expect(plugin.variation({ key: 'theme', defaultValue: null })).resolves.toEqual({
      value: { colour: 'green' },
    });
    expect(client.jsonVariation).toHaveBeenCalledWith('theme', null);
    await expect(plugin.allFlags()).resolves.toEqual({ flags: { theme: { colour: 'green' } } });
  });

  it('answers initialized false and no flags before any start', async () => {
    const plugin = new LaunchDarklyWeb(async () => fakeSdk().sdk);
    await expect(plugin.getState()).resolves.toEqual({ initialized: false, source: 'none', flags: {} });
    await expect(plugin.waitForInitialization()).resolves.toEqual({ initialized: false, timedOut: false });
  });

  it('reports a start that timed out as not initialized, then waits for the flags on request', async () => {
    const { sdk, client } = fakeSdk();
    client.start.mockResolvedValueOnce({ status: 'timeout' } as never);
    const plugin = new LaunchDarklyWeb(async () => sdk);
    const state = await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
    expect(state.initialized).toBe(false);
    expect(state.source).toBe('cache');
    await expect(plugin.waitForInitialization({ timeoutSeconds: 1 })).resolves.toEqual({
      initialized: true,
      timedOut: false,
    });
    expect(client.waitForInitialization).toHaveBeenCalledWith({ timeout: 1 });
  });

  it('maps setStreaming and setOnline onto the stream, and closes', async () => {
    const { sdk, client } = fakeSdk();
    const plugin = new LaunchDarklyWeb(async () => sdk);
    await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
    await plugin.setOnline({ online: false });
    await plugin.setOnline({ online: true });
    await plugin.setStreaming({ enabled: false });
    await plugin.setOnline({ online: true });
    expect(client.setStreaming.mock.calls).toEqual([[false], [true], [false], [false]]);
    await plugin.flush();
    expect(client.flush).toHaveBeenCalled();
    await plugin.close();
    expect(client.close).toHaveBeenCalled();
    await expect(plugin.getState()).resolves.toEqual({ initialized: false, source: 'none', flags: {} });
  });

  it('tells the app to install the web SDK when it cannot be imported', async () => {
    const plugin = new LaunchDarklyWeb(() => Promise.reject(new Error('Cannot find module')));
    await expect(plugin.initialize({ clientSideId: 'cs-1', context: anonymous })).rejects.toThrow(MISSING_SDK_MESSAGE);
  });

  it('still works when localStorage is not available', async () => {
    const saved = (globalThis as Record<string, unknown>).localStorage;
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    try {
      const { sdk } = fakeSdk();
      const plugin = new LaunchDarklyWeb(async () => sdk);
      await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
      await expect(plugin.identify({ context: ann })).resolves.toEqual({ timedOut: false });
      await expect(plugin.clearStoredContext()).resolves.toBeUndefined();
    } finally {
      (globalThis as Record<string, unknown>).localStorage = saved;
    }
  });
});

describe('on the web, offline', () => {
  // An SDK whose network never answers: start, waitForInitialization and identify never settle. What it has is the cache.
  function offlineSdk(cached: Record<string, unknown>, announceCache = true) {
    const fake = fakeSdk(cached);
    const never = () => new Promise<never>(() => undefined);
    fake.client.start.mockImplementation(never);
    fake.client.waitForInitialization.mockImplementation(never);
    fake.client.identify.mockImplementation(never);
    if (announceCache) {
      // The SDK announces the flags it read from localStorage with a 'change' event, a moment after start().
      fake.client.start.mockImplementation(() => {
        setTimeout(() => fake.client.fire('change', anonymous, Object.keys(cached)), 5);
        return never();
      });
    }
    return fake;
  }

  it('initialize() and getState() resolve with the cached flags without waiting for the network', async () => {
    const { sdk } = offlineSdk({ on: true, theme: 'green' });
    const plugin = new LaunchDarklyWeb(async () => sdk);
    const began = Date.now();
    const state = await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
    expect(Date.now() - began).toBeLessThan(CACHE_READ_MS);
    expect(state).toEqual({
      initialized: false,
      source: 'cache',
      flags: { on: true, theme: 'green' },
      context: anonymous,
    });
    const again = Date.now();
    await expect(plugin.getState()).resolves.toEqual(state);
    expect(Date.now() - again).toBeLessThan(20);
  });

  it('waits for the cache read at most CACHE_READ_MS when nothing is announced', async () => {
    const { sdk } = offlineSdk({}, false);
    const plugin = new LaunchDarklyWeb(async () => sdk);
    const began = Date.now();
    const state = await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
    expect(Date.now() - began).toBeLessThan(CACHE_READ_MS + 200);
    expect(state).toEqual({ initialized: false, source: 'none', flags: {}, context: anonymous });
  });

  it('waitForInitialization() resolves timed out after its timeout instead of hanging or rejecting', async () => {
    const { sdk } = offlineSdk({ on: true });
    const plugin = new LaunchDarklyWeb(async () => sdk);
    await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
    await expect(plugin.waitForInitialization({ timeoutSeconds: 0.05 })).resolves.toEqual({
      initialized: false,
      timedOut: true,
    });
  });

  it('identify() resolves timed out after its timeout, stores the context and switches to it', async () => {
    const { sdk } = offlineSdk({ on: true });
    const plugin = new LaunchDarklyWeb(async () => sdk);
    await plugin.initialize({ clientSideId: 'cs-1', context: anonymous });
    const began = Date.now();
    await expect(plugin.identify({ context: ann, timeoutSeconds: 0.05 })).resolves.toEqual({ timedOut: true });
    expect(Date.now() - began).toBeLessThan(1000);
    expect(JSON.parse(storage.get(STORED_CONTEXT_KEY)!)).toEqual(ann);
    await expect(plugin.getState()).resolves.toMatchObject({ context: ann, source: 'cache' });
  });
});
