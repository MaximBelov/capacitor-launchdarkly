/// <reference types="capacitor-launchdarkly" />
import type { CapacitorConfig } from '@capacitor/cli';

// No key is committed. Set LAUNCHDARKLY_MOBILE_KEY when you run `npx cap sync` to try the native start-up: the key is then
// written into the native projects' copy of this config (which is not committed either). Without it nothing starts natively,
// and the app's "Initialize" button starts the client with the key typed into the field.
const mobileKey = process.env.LAUNCHDARKLY_MOBILE_KEY;

const config: CapacitorConfig = {
  appId: 'com.example.plugin',
  appName: 'example-app',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
    },
    ...(mobileKey
      ? {
          LaunchDarkly: {
            mobileKey,
            initialContext: { kind: 'user', key: 'anonymous_user', anonymous: true },
            startWaitSeconds: 5,
          },
        }
      : {}),
  },
};

export default config;
