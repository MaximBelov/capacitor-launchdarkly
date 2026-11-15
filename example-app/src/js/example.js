import { Capacitor } from '@capacitor/core';
import { LaunchDarkly } from 'capacitor-launchdarkly';

const result = document.getElementById('result');
const events = document.getElementById('events');
const value = (id) => document.getElementById(id).value.trim();
const context = () => JSON.parse(value('context'));

const show = (data) => {
  result.textContent = JSON.stringify(data, null, 2);
};

const run = (id, action) => {
  document.getElementById(id).addEventListener('click', async () => {
    result.textContent = '...';
    try {
      show((await action()) ?? 'done');
    } catch (error) {
      show({ rejected: error.code ?? '', message: error.message });
    }
  });
};

const log = (name, data) => {
  events.textContent = `${new Date().toLocaleTimeString()} ${name} ${JSON.stringify(data)}\n${events.textContent}`;
};

LaunchDarkly.addListener('flagChange', (change) => log('flagChange', change));
LaunchDarkly.addListener('connectionModeChange', (change) => log('connectionModeChange', change));

run('initialize', () => {
  const key = value('key');
  // Each platform takes its own key; the other is ignored.
  return LaunchDarkly.initialize(
    Capacitor.isNativePlatform() ? { mobileKey: key, context: context() } : { clientSideId: key, context: context() },
  );
});
run('waitForInitialization', () => LaunchDarkly.waitForInitialization({ timeoutSeconds: 5 }));
run('getState', () => LaunchDarkly.getState());
run('identify', () => LaunchDarkly.identify({ context: context() }));
run('variation', () => LaunchDarkly.variation({ key: value('flag'), defaultValue: null }));
run('allFlags', () => LaunchDarkly.allFlags());
run('streamingOn', () => LaunchDarkly.setStreaming({ enabled: true }));
run('streamingOff', () => LaunchDarkly.setStreaming({ enabled: false }));
run('online', () => LaunchDarkly.setOnline({ online: true }));
run('offline', () => LaunchDarkly.setOnline({ online: false }));
run('flush', () => LaunchDarkly.flush());
run('close', () => LaunchDarkly.close());
run('clearStoredContext', () => LaunchDarkly.clearStoredContext());

// With the native start-up configured, show what is already there.
LaunchDarkly.getState().then(show, () => undefined);
