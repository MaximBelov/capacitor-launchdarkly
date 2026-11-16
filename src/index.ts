import { registerPlugin } from '@capacitor/core';

import type { LaunchDarklyPlugin } from './definitions';

// One web implementation per page. Capacitor calls this loader for every method call made before the first load has
// settled, so without the memo, calls made together at start-up (a listener, a read, a set-up) each got an instance of
// their own, and state set through one of them was missing from the one kept.
let web: Promise<unknown> | undefined;

const LaunchDarkly = registerPlugin<LaunchDarklyPlugin>('LaunchDarkly', {
  web: () => (web ??= import('./web').then((m) => new m.LaunchDarklyWeb())),
});

export * from './definitions';
export { LaunchDarkly };
