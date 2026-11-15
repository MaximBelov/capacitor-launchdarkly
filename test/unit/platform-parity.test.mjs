// Every method of the TypeScript API has its method in the web implementation, on both native platforms and in the README, and
// no platform has a method the API does not declare. Both native platforms also read the same keys of the capacitor.config
// block the TypeScript declares. A miss on either side compiles fine and fails only on a phone. Plain Node, no install.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const sorted = (list) => [...new Set(list)].sort();
const SWIFT = 'ios/Sources/LaunchDarklyPlugin';
const KOTLIN = 'android/src/main/kotlin/io/github/maximbelov/launchdarkly';

const definitions = read('src/definitions.ts');
const pluginInterface = definitions.match(/export interface LaunchDarklyPlugin \{([\s\S]*?)\n\}/)[1];
// removeAllListeners and addListener come from Capacitor on every platform; they are not plugin methods of their own.
const api = sorted(
  [...pluginInterface.matchAll(/^\s+(\w+)\([^)]*\):\s*Promise</gm)]
    .map((m) => m[1])
    .filter((m) => m !== 'removeAllListeners'),
);
const web = sorted([...read('src/web.ts').matchAll(/^\s+async (\w+)\(/gm)].map((m) => m[1]));
const ios = sorted(
  [...read(`${SWIFT}/LaunchDarklyPlugin.swift`).matchAll(/CAPPluginMethod\(name:\s*"(\w+)"/g)].map((m) => m[1]),
);
const iosFunctions = sorted(
  [...read(`${SWIFT}/LaunchDarklyPlugin.swift`).matchAll(/@objc func (\w+)\(_ call: CAPPluginCall\)/g)].map(
    (m) => m[1],
  ),
);
const android = sorted(
  [...read(`${KOTLIN}/LaunchDarklyPlugin.kt`).matchAll(/@PluginMethod\s+fun (\w+)\(/g)].map((m) => m[1]),
);

const fieldsOf = (name) => {
  const body = definitions.match(new RegExp(`export interface ${name}(?: extends \\w+)? \\{([\\s\\S]*?)\\n\\}`))[1];
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
};

test('the API declares the methods it is meant to', () => {
  assert.deepEqual(api, [
    'allFlags',
    'clearStoredContext',
    'close',
    'flush',
    'getState',
    'identify',
    'initialize',
    'setOnline',
    'setStreaming',
    'variation',
    'waitForInitialization',
  ]);
});

test('the web implementation has exactly the methods of the API', () => {
  assert.deepEqual(web, api);
});

test('iOS registers exactly the methods of the API', () => {
  assert.deepEqual(ios, api);
});

test('iOS has an @objc function for every registered method', () => {
  assert.deepEqual(iosFunctions, api);
});

test('Android annotates exactly the methods of the API', () => {
  assert.deepEqual(android, api);
});

test('the plugin has the same name in JavaScript, Swift and Kotlin, and the config block is named for it', () => {
  assert.match(read('src/index.ts'), /registerPlugin<LaunchDarklyPlugin>\('LaunchDarkly'/);
  assert.match(read(`${SWIFT}/LaunchDarklyPlugin.swift`), /jsName = "LaunchDarkly"/);
  assert.match(read(`${KOTLIN}/LaunchDarklyPlugin.kt`), /@CapacitorPlugin\(name = "LaunchDarkly"\)/);
  assert.match(definitions, /^ {4}LaunchDarkly\?: \{/m);
});

test('both platforms read exactly the config keys the TypeScript declares', () => {
  const block = definitions.match(/LaunchDarkly\?: \{([\s\S]*?)\n {4}\};/)[1];
  const declared = sorted([
    ...[...block.matchAll(/^ {6}(\w+)\?:/gm)].map((m) => m[1]),
    ...fieldsOf('LDApplicationInfo'),
  ]);
  // The options initialize() takes are the same, apart from bootstrap, which is for the web SDK only.
  assert.deepEqual(
    sorted(fieldsOf('LaunchDarklyOptions').filter((key) => key !== 'bootstrap')),
    sorted(
      [...block.matchAll(/^ {6}(\w+)\?:/gm)]
        .map((m) => m[1])
        .filter((key) => !['mobileKey', 'initialContext'].includes(key)),
    ),
  );
  const swift = sorted(
    [...read(`${SWIFT}/StartOptions.swift`).matchAll(/(?:config|app)\["(\w+)"\]/g)].map((m) => m[1]),
  );
  const kotlin = sorted([...read(`${KOTLIN}/StartOptions.kt`).matchAll(/\.opt\w*\("(\w+)"/g)].map((m) => m[1]));
  assert.deepEqual(swift, declared);
  assert.deepEqual(kotlin, declared);
});

test('both platforms default to the same shared anonymous context', () => {
  const swift = read(`${SWIFT}/StartOptions.swift`).match(/defaultInitialContext = #"(.*)"#/)[1];
  const kotlin = read(`${KOTLIN}/StartOptions.kt`).match(/DEFAULT_INITIAL_CONTEXT = """(.*)"""/)[1];
  assert.deepEqual(JSON.parse(swift), { kind: 'user', key: 'anonymous_user', anonymous: true });
  assert.deepEqual(JSON.parse(kotlin), JSON.parse(swift));
});

test('both platforms resolve getState() with the fields of LaunchDarklyState', () => {
  const fields = sorted(fieldsOf('LaunchDarklyState'));
  const swift = read(`${SWIFT}/LaunchDarklyPlugin.swift`).match(/static func state[\s\S]*?\n {4}\}/)[0];
  const kotlin = read(`${KOTLIN}/LaunchDarklyPlugin.kt`).match(/private fun state\(\)[\s\S]*?\n {4}\}/)[0];
  assert.deepEqual(sorted([...swift.matchAll(/"(\w+)"\]?\s*[:=]/g)].map((m) => m[1])), fields);
  assert.deepEqual(sorted([...kotlin.matchAll(/put\("(\w+)"/g)].map((m) => m[1])), fields);
});

test('the native SDKs are configured with automatic environment attributes disabled and no generated keys', () => {
  assert.match(read(`${SWIFT}/ConfigFactory.swift`), /autoEnvAttributes: \.disabled/);
  const kotlin = read(`${KOTLIN}/LdConfigFactory.kt`);
  assert.match(kotlin, /AutoEnvAttributes\.Disabled/);
  assert.match(kotlin, /\.generateAnonymousKeys\(false\)/);
});

test('the README documents every method and the config block', () => {
  const readme = read('README.md');
  for (const method of api) {
    assert.match(readme, new RegExp(`### ${method}\\(`), `README.md has no section for ${method}()`);
  }
  assert.match(readme, /<docgen-config>/);
});
