import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { LaunchDarklyPlugin } from '../../src';

// What the native side of Capacitor injects into the web view: a bridge object that makes the platform 'android', the headers of
// the installed plugins, and nativePromise, which every promise method of a plugin goes through.
const nativePromise = vi.fn(async (): Promise<unknown> => undefined);
const g = globalThis as Record<string, unknown>;
const methods = [
  'initialize',
  'waitForInitialization',
  'getState',
  'identify',
  'variation',
  'allFlags',
  'setStreaming',
  'setOnline',
  'flush',
  'close',
  'clearStoredContext',
];

let LaunchDarkly: LaunchDarklyPlugin;

beforeAll(async () => {
  g.androidBridge = {};
  g.Capacitor = {
    PluginHeaders: [{ name: 'LaunchDarkly', methods: methods.map((name) => ({ name, rtype: 'promise' })) }],
    nativePromise,
  };
  ({ LaunchDarkly } = await import('../../src'));
});

afterAll(() => {
  delete g.androidBridge;
  delete g.Capacitor;
});

describe('on a native platform', () => {
  it('sends identify with the context as given, the anonymous key included', async () => {
    const context = { kind: 'user', key: 'anonymous_user', anonymous: true };
    nativePromise.mockResolvedValueOnce({ timedOut: false });
    await expect(LaunchDarkly.identify({ context })).resolves.toEqual({ timedOut: false });
    expect(nativePromise).toHaveBeenCalledWith('LaunchDarkly', 'identify', { context });
  });

  it('sends variation with a default of any JSON type and answers what native answers', async () => {
    nativePromise.mockResolvedValueOnce({ value: { colour: 'green' } });
    const result = await LaunchDarkly.variation({ key: 'theme', defaultValue: { colour: 'grey' } });
    expect(result).toEqual({ value: { colour: 'green' } });
    expect(nativePromise).toHaveBeenLastCalledWith('LaunchDarkly', 'variation', {
      key: 'theme',
      defaultValue: { colour: 'grey' },
    });
  });

  it('reaches every method of the API on the native plugin, not the web implementation', async () => {
    for (const method of methods) {
      nativePromise.mockClear();
      await (LaunchDarkly as unknown as Record<string, (o?: unknown) => Promise<unknown>>)[method]({});
      expect(nativePromise).toHaveBeenCalledWith('LaunchDarkly', method, {});
    }
  });

  it('passes on what the native side answers', async () => {
    nativePromise.mockRejectedValueOnce(new Error('from native'));
    await expect(LaunchDarkly.getState()).rejects.toThrow('from native');
  });
});
