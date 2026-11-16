import { describe, expect, it, vi } from 'vitest';

describe('the web implementation', () => {
  it('is one instance for calls made together before it has loaded', async () => {
    const web = await import('../../src/web');
    const method = vi.spyOn(web.LaunchDarklyWeb.prototype, 'getState');
    const { LaunchDarkly } = await import('../../src');

    await Promise.all([LaunchDarkly.getState(), LaunchDarkly.getState(), LaunchDarkly.getState()]);

    expect(method).toHaveBeenCalledTimes(3);
    expect(new Set(method.mock.contexts).size).toBe(1);
    method.mockRestore();
  });
});
