import { registerPlugin } from '@capacitor/core';

import type { LaunchDarklyPlugin } from './definitions';

const LaunchDarkly = registerPlugin<LaunchDarklyPlugin>('LaunchDarkly', {
  web: () => import('./web').then((m) => new m.LaunchDarklyWeb()),
});

export * from './definitions';
export { LaunchDarkly };
