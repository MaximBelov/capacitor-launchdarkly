# capacitor-launchdarkly

[LaunchDarkly](https://launchdarkly.com) feature flags for Capacitor apps, with one API on iOS, Android and the web. On iOS and
Android it runs LaunchDarkly's native client SDKs and can start the client natively as the app launches, before the web view
runs any of your code; on the web it runs LaunchDarkly's browser SDK.

|                           | iOS                                    | Android                                      | Web                                             |
| ------------------------- | -------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| SDK                       | LaunchDarkly iOS client SDK 11.8.0     | LaunchDarkly Android client SDK 5.18.0       | `@launchdarkly/js-client-sdk` 4.x (you install) |
| Key                       | mobile key (`mob-…`)                   | mobile key (`mob-…`)                         | client-side ID                                  |
| Where the client starts   | natively at launch, or `initialize()`  | natively at launch, or `initialize()`        | `initialize()`                                  |
| Stored context            | `UserDefaults`                         | `SharedPreferences`                          | `localStorage`                                  |
| `connectionModeChange`    | yes                                    | yes                                          | never fired                                     |

## Install

```bash
npm install capacitor-launchdarkly
npx cap sync
```

Requires Capacitor 8. Android 7.0 (API 24) or newer, iOS 15 or newer. On iOS the plugin is a Swift package; CocoaPods works too.
The native SDKs come with the plugin, pinned to the versions above. An Android app can move its SDK with
`launchDarklyAndroidVersion` in `android/variables.gradle`.

To use the plugin **on the web** as well, install LaunchDarkly's browser SDK next to it:

```bash
npm install @launchdarkly/js-client-sdk
```

It is an optional peer dependency. The plugin imports it only when `initialize()` runs in a browser, so a native-only app never
loads it. Without it, `initialize()` on the web rejects with an error saying to install it.

## Native start-up

Put the mobile key in `capacitor.config` and the client starts as the app launches:

```json
{
  "plugins": {
    "LaunchDarkly": {
      "mobileKey": "mob-00000000-0000-0000-0000-000000000000",
      "initialContext": { "kind": "user", "key": "anonymous_user", "anonymous": true },
      "startWaitSeconds": 5
    }
  }
}
```

Why start natively rather than from JavaScript:

- **The flags are there at launch.** The plugin's `load()` runs while Capacitor creates its bridge, before the web view loads
  your app, so the first request to LaunchDarkly is on its way (or already answered) when your code first asks.
- **No anonymous flip.** Every `identify()` stores the context it switched to, and the next start-up begins with that stored
  context instead of `initialContext`. A signed-in user stays signed in as far as the flags are concerned, from the first frame,
  and the SDK serves that context's cached flags while it fetches fresh ones.
- **One client per process.** The client belongs to the process, not to the web view: a recreated activity or a reloaded page
  finds it running. A later `initialize()` with the same key changes nothing and answers the current state.

The web layer then reads what is already there:

```typescript
import { LaunchDarkly } from 'capacitor-launchdarkly';

const { initialized, context, flags } = await LaunchDarkly.getState(); // waits for the start-up if it is still running

await LaunchDarkly.addListener('flagChange', ({ key, value, previous }) => {
  console.log(`${key} changed from ${JSON.stringify(previous)} to ${JSON.stringify(value)}`);
});

const { value } = await LaunchDarkly.variation({ key: 'new-checkout', defaultValue: false });
```

On sign-in and sign-out, switch the context. The plugin stores it, so the next launch starts with it:

```typescript
await LaunchDarkly.identify({ context: { kind: 'user', key: user.id, name: user.name } });
// signing out: back to the shared anonymous context, which becomes the stored one
await LaunchDarkly.identify({ context: { kind: 'user', key: 'anonymous_user', anonymous: true } });
```

`clearStoredContext()` forgets the stored context altogether, so the next start-up uses `initialContext` again.

Do not commit a real mobile key to a public repository. A mobile key is not a secret in the way a server-side SDK key is (it
ships inside every copy of your app), but it is still yours: keep it in your app's own configuration.

Without a `mobileKey` in the config, nothing starts natively, and the app calls `initialize()` with one, as it does on the web.

## Starting from JavaScript, and on the web

```typescript
import { Capacitor } from '@capacitor/core';

await LaunchDarkly.initialize({
  mobileKey: 'mob-…', // used on iOS and Android
  clientSideId: '…', // used on the web
  context: { kind: 'user', key: 'anonymous_user', anonymous: true },
  options: { startWaitSeconds: 5, bootstrap: 'localStorage' },
});
```

`initialize()` accepts both keys, and each platform takes its own. The context you pass plays the part of `initialContext`: a
context an earlier `identify()` stored wins over it, on the web too.

On the web, `options.bootstrap` decides what the client shows before LaunchDarkly answers: `'localStorage'` starts from the flags
the browser SDK cached for that context on an earlier visit (the SDK does this on its own), and a flag object, for example one
your server rendered into the page, starts from those values.

What has no direct equivalent in the browser SDK:

- **`setOnline()`** – the browser SDK has no offline mode. Offline closes the stream, so no flag updates arrive; online opens it
  again when streaming is on. Analytics events are still sent.
- **`offline: true`** at start – starts without a stream; the first flags are still fetched once.
- **`setStreaming()`** – the browser SDK switches in place. The native SDKs cannot change their data source while they run, so
  there the plugin closes the client and starts it again with the current context.
- **`connectionModeChange`** – never fired on the web.

## Contexts, and what LaunchDarkly bills

Contexts use the JSON shape of LaunchDarkly's SDKs: a single context `{ kind, key, name?, anonymous?, ...attributes }`, custom
attributes of any JSON type (nested objects and arrays included), private attributes in `_meta.privateAttributes`, and
multi-contexts `{ kind: 'multi', user: {...}, organization: {...} }`. The native side hands the JSON to the SDK's own parser
(`JsonSerialization` on Android, `LDContext`'s `Decodable` on iOS), so every field means what it means to LaunchDarkly.

LaunchDarkly bills client-side SDKs by monthly active users: the number of unique context keys, counted for the context kind that
has the most ([how billing is calculated](https://launchdarkly.com/docs/home/account/calculating-billing)). The plugin makes sure
that only the keys your app passes are ever counted:

- **Automatic environment attributes are off**, on both native platforms (`AutoEnvAttributes.Disabled` / `.disabled`), and the
  browser SDK never adds them. With them on, the SDK adds `ld_application` and `ld_device` contexts to every evaluation, and the
  `ld_device` key is generated per install, which counts every device as a context of its own
  ([automatic environment attributes](https://launchdarkly.com/docs/sdk/features/environment-attributes)). This is not an
  option.
- **Keys are never generated.** An anonymous context keeps the key you give it, so an app can use one shared key (for example
  `anonymous_user`) for every signed-out user. Android is configured with `generateAnonymousKeys(false)`; the iOS SDK generates a
  key only for a context built without one, which the plugin never does; and a context without a key is refused on every
  platform, because the browser SDK would otherwise generate one for an anonymous context.

Native unit tests pin both: the built configuration has environment attributes off and key generation off, and an anonymous
context comes out of the SDK's own context processing with its key (see "Testing").

`sendEventsOnlyForVariation`, an option of the old JavaScript SDK, has no equivalent in either native SDK. `getState()` and
`allFlags()` read the SDK's store and send no evaluation events on any platform; `variation()` sends one, as any SDK evaluation
does.

## iOS privacy manifest

The plugin keeps the stored context in `UserDefaults`, one of Apple's
[required-reason APIs](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files/describing_use_of_required_reason_api),
and ships its own `PrivacyInfo.xcprivacy` declaring `NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1`. The
LaunchDarkly SDK ships its own manifest too. Declare the same category in your app's manifest if your app does not already.

## Configuration

<docgen-config>
<!--Update the source file JSDoc comments and rerun docgen to update the docs below-->

Starts the native LaunchDarkly client as the app launches, before the
web view runs any app code. Leave `mobileKey` out to start it from
JavaScript with `initialize()` instead. iOS and Android only.

| Prop                    | Type                                                            | Description                                                                                                                           | Default                                                               | Since |
| ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----- |
| **`mobileKey`**         | <code>string</code>                                             | The mobile key of the LaunchDarkly environment. Without it there is no native start-up, and `initialize()` starts the client instead. |                                                                       | 0.1.0 |
| **`initialContext`**    | <code><a href="#ldcontext">LDContext</a></code>                 | The context the native start-up uses when no context was stored by an earlier `identify()`.                                           | <code>{ kind: 'user', key: 'anonymous_user', anonymous: true }</code> | 0.1.0 |
| **`streaming`**         | <code>boolean</code>                                            | Streams flag updates when `true`, polls when `false`.                                                                                 | <code>true</code>                                                     | 0.1.0 |
| **`evaluationReasons`** | <code>boolean</code>                                            | Asks LaunchDarkly for the reason behind each evaluation.                                                                              | <code>false</code>                                                    | 0.1.0 |
| **`offline`**           | <code>boolean</code>                                            | Starts the client offline, until `setOnline({ online: true })`.                                                                       | <code>false</code>                                                    | 0.1.0 |
| **`startWaitSeconds`**  | <code>number</code>                                             | How long the start waits for the first set of flags, in seconds.                                                                      | <code>5</code>                                                        | 0.1.0 |
| **`application`**       | <code><a href="#ldapplicationinfo">LDApplicationInfo</a></code> | Application metadata sent to LaunchDarkly with every request.                                                                         |                                                                       | 0.1.0 |

### Examples

In `capacitor.config.json`:

```json
{
  "plugins": {
    "LaunchDarkly": {
      "mobileKey": "mob-00000000-0000-0000-0000-000000000000",
      "initialContext": { "kind": "user", "key": "anonymous_user", "anonymous": true },
      "streaming": true,
      "evaluationReasons": false,
      "offline": false,
      "startWaitSeconds": 5,
      "application": { "id": "com.example.plugin", "version": "1.0.0" }
    }
  }
}
```

In `capacitor.config.ts`:

```ts
/// <reference types="capacitor-launchdarkly" />

import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  plugins: {
    LaunchDarkly: {
      mobileKey: "mob-00000000-0000-0000-0000-000000000000",
      initialContext: { "kind": "user", "key": "anonymous_user", "anonymous": true },
      streaming: true,
      evaluationReasons: false,
      offline: false,
      startWaitSeconds: 5,
      application: { "id": "com.example.plugin", "version": "1.0.0" },
    },
  },
};

export default config;
```

</docgen-config>

## API

<docgen-index>

* [`initialize(...)`](#initialize)
* [`waitForInitialization(...)`](#waitforinitialization)
* [`getState()`](#getstate)
* [`identify(...)`](#identify)
* [`variation(...)`](#variation)
* [`allFlags()`](#allflags)
* [`setStreaming(...)`](#setstreaming)
* [`setOnline(...)`](#setonline)
* [`flush()`](#flush)
* [`close()`](#close)
* [`clearStoredContext()`](#clearstoredcontext)
* [`addListener('flagChange', ...)`](#addlistenerflagchange-)
* [`addListener('connectionModeChange', ...)`](#addlistenerconnectionmodechange-)
* [`removeAllListeners()`](#removealllisteners)
* [Interfaces](#interfaces)
* [Type Aliases](#type-aliases)

</docgen-index>

<docgen-api>
<!--Update the source file JSDoc comments and rerun docgen to update the docs below-->

### initialize(...)

```typescript
initialize(options: InitializeOptions) => Promise<LaunchDarklyState>
```

Starts the client from JavaScript and waits for the first set of flags or
`options.startWaitSeconds` (5 by default), whichever comes first.

- **iOS, Android**: takes `mobileKey`. Needed only by an app that does not
  put a `mobileKey` in `capacitor.config`; with one there, the client is
  already running when the app's code starts, and this call only answers
  its state.
- **Web**: takes `clientSideId`, and is the only way to start the client.
  Needs `@launchdarkly/js-client-sdk` installed (see the README).

`context` plays the part of `initialContext`: when an earlier `identify()`
stored a context, the client starts with the stored one instead, so the
app does not flip to an anonymous context for a moment after a restart.

There is one client per process (per page on the web). A second call with
the same key, or a call after the native start-up already started a
client with that key, changes nothing: the client is not created again,
`context` and `options` are ignored, and the current state is answered.
Use `identify()` to switch the context. A call with a different key closes
the running client and starts a new one.

| Param         | Type                                                            |
| ------------- | --------------------------------------------------------------- |
| **`options`** | <code><a href="#initializeoptions">InitializeOptions</a></code> |

**Returns:** <code>Promise&lt;<a href="#launchdarklystate">LaunchDarklyState</a>&gt;</code>

**Since:** 0.1.0

--------------------


### waitForInitialization(...)

```typescript
waitForInitialization(options?: WaitForInitializationOptions | undefined) => Promise<WaitForInitializationResult>
```

Answers whether the client has received its first set of flags, waiting
up to `timeoutSeconds` (5 by default) for that when it has not yet.

Resolves `{ initialized: false }` straight away when no client was
started, neither natively nor with `initialize()`.

| Param         | Type                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- |
| **`options`** | <code><a href="#waitforinitializationoptions">WaitForInitializationOptions</a></code> |

**Returns:** <code>Promise&lt;<a href="#waitforinitializationresult">WaitForInitializationResult</a>&gt;</code>

**Since:** 0.1.0

--------------------


### getState()

```typescript
getState() => Promise<LaunchDarklyState>
```

The state of the native client: whether it has its flags, the current
context and the value of every flag, read from the native SDK's own
store. Meant for bootstrapping the web layer at start without a second
network round trip.

While the native start-up is still running, this waits until it is done:
until the first set of flags is in, or `startWaitSeconds` has passed.
With no client at all it answers `initialized: false` and no flags.

Reading the flags this way sends no evaluation events.

**Returns:** <code>Promise&lt;<a href="#launchdarklystate">LaunchDarklyState</a>&gt;</code>

**Since:** 0.1.0

--------------------


### identify(...)

```typescript
identify(options: IdentifyOptions) => Promise<IdentifyResult>
```

Switches the client to another context and resolves when the flags for
it are loaded, or when `timeoutSeconds` (5 by default) has passed.

The context the SDK accepted is stored natively, under a key of the
plugin's own, and the next native start-up begins with it instead of
`initialContext`. So an app logs out by identifying its anonymous
context, which then becomes the stored one; `clearStoredContext()`
forgets it altogether.

An anonymous context keeps the key it is given. The plugin never asks the
SDK to generate one.

| Param         | Type                                                        |
| ------------- | ----------------------------------------------------------- |
| **`options`** | <code><a href="#identifyoptions">IdentifyOptions</a></code> |

**Returns:** <code>Promise&lt;<a href="#identifyresult">IdentifyResult</a>&gt;</code>

**Since:** 0.1.0

--------------------


### variation(...)

```typescript
variation(options: VariationOptions) => Promise<VariationResult>
```

Evaluates one flag for the current context and answers its value, of any
JSON type, or `defaultValue` (`null` when left out) when the flag is
unknown or the client has not started. Goes through the SDK's JSON
variation call, so it records an evaluation event like any SDK call.

| Param         | Type                                                          |
| ------------- | ------------------------------------------------------------- |
| **`options`** | <code><a href="#variationoptions">VariationOptions</a></code> |

**Returns:** <code>Promise&lt;<a href="#variationresult">VariationResult</a>&gt;</code>

**Since:** 0.1.0

--------------------


### allFlags()

```typescript
allFlags() => Promise<AllFlagsResult>
```

The value of every flag for the current context, from the native SDK's
store. Sends no evaluation events. Empty when the client has not started.

**Returns:** <code>Promise&lt;<a href="#allflagsresult">AllFlagsResult</a>&gt;</code>

**Since:** 0.1.0

--------------------


### setStreaming(...)

```typescript
setStreaming(options: SetStreamingOptions) => Promise<void>
```

Switches between streaming and polling. Neither native SDK can change its
data source while it runs, so the plugin closes the client and starts it
again with the same mobile key, options and current context, then waits as
at start-up. Flag listeners stay registered. The web SDK switches in place
(`setStreaming()`).

| Param         | Type                                                                |
| ------------- | ------------------------------------------------------------------- |
| **`options`** | <code><a href="#setstreamingoptions">SetStreamingOptions</a></code> |

**Since:** 0.1.0

--------------------


### setOnline(...)

```typescript
setOnline(options: SetOnlineOptions) => Promise<void>
```

Takes the client online or offline (`setOnline()` / `setOffline()` on
Android, `setOnline(_:)` on iOS). Offline, the client keeps answering the
values it has.

The web SDK has no offline mode. There, going offline closes the stream so
no flag updates arrive, and going online opens it again if `streaming` is
on; analytics events are still sent.

| Param         | Type                                                          |
| ------------- | ------------------------------------------------------------- |
| **`options`** | <code><a href="#setonlineoptions">SetOnlineOptions</a></code> |

**Since:** 0.1.0

--------------------


### flush()

```typescript
flush() => Promise<void>
```

Sends the analytics events the client has queued.

**Since:** 0.1.0

--------------------


### close()

```typescript
close() => Promise<void>
```

Closes the client. It can be started again with `initialize()`; until
then, `variation()` answers the default value. The stored context is
kept.

**Since:** 0.1.0

--------------------


### clearStoredContext()

```typescript
clearStoredContext() => Promise<void>
```

Forgets the context `identify()` stored, so the next native start-up
begins with `initialContext` again. The running client is not changed.

**Since:** 0.1.0

--------------------


### addListener('flagChange', ...)

```typescript
addListener(eventName: 'flagChange', listenerFunc: (change: FlagChange) => void) => Promise<PluginListenerHandle>
```

Called for every flag whose value changes: from the stream or a poll, and
after `identify()` for each flag whose value differs for the new context.

| Param              | Type                                                                   |
| ------------------ | ---------------------------------------------------------------------- |
| **`eventName`**    | <code>'flagChange'</code>                                              |
| **`listenerFunc`** | <code>(change: <a href="#flagchange">FlagChange</a>) =&gt; void</code> |

**Returns:** <code>Promise&lt;<a href="#pluginlistenerhandle">PluginListenerHandle</a>&gt;</code>

**Since:** 0.1.0

--------------------


### addListener('connectionModeChange', ...)

```typescript
addListener(eventName: 'connectionModeChange', listenerFunc: (change: ConnectionModeChange) => void) => Promise<PluginListenerHandle>
```

Called when the SDK's connection mode changes, for example from streaming
to offline. iOS and Android only: the web SDK has no connection mode, and
this is never called there.

| Param              | Type                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------ |
| **`eventName`**    | <code>'connectionModeChange'</code>                                                        |
| **`listenerFunc`** | <code>(change: <a href="#connectionmodechange">ConnectionModeChange</a>) =&gt; void</code> |

**Returns:** <code>Promise&lt;<a href="#pluginlistenerhandle">PluginListenerHandle</a>&gt;</code>

**Since:** 0.1.0

--------------------


### removeAllListeners()

```typescript
removeAllListeners() => Promise<void>
```

Removes every listener of this plugin.

**Since:** 0.1.0

--------------------


### Interfaces


#### LaunchDarklyState

| Prop              | Type                                            | Description                                                                                                               | Since |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----- |
| **`initialized`** | <code>boolean</code>                            | Whether the client has received its first set of flags, from the network or, when it was started offline, from its cache. | 0.1.0 |
| **`context`**     | <code><a href="#ldcontext">LDContext</a></code> | The current context. Absent when no client was started.                                                                   | 0.1.0 |
| **`flags`**       | <code><a href="#ldflagset">LDFlagSet</a></code> | The value of every flag for the current context.                                                                          | 0.1.0 |


#### LDSingleKindContext

A context of one kind. Any other property is a custom attribute: a string,
number, boolean, array or object.

| Prop            | Type                                                    | Description                                                                                         | Since |
| --------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----- |
| **`kind`**      | <code>string</code>                                     | The context kind, for example `user` or `organization`.                                             | 0.1.0 |
| **`key`**       | <code>string</code>                                     | The key. An anonymous context keeps the key it is given.                                            | 0.1.0 |
| **`name`**      | <code>string</code>                                     |                                                                                                     | 0.1.0 |
| **`anonymous`** | <code>boolean</code>                                    | Leaves the context out of the dashboard's context list. It is still counted for billing by its key. | 0.1.0 |
| **`_meta`**     | <code><a href="#ldcontextmeta">LDContextMeta</a></code> |                                                                                                     | 0.1.0 |


#### LDContextMeta

| Prop                    | Type                  | Description                                                                                            | Since |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------ | ----- |
| **`privateAttributes`** | <code>string[]</code> | Attributes, by name or `/`-separated reference, that are not sent to LaunchDarkly in analytics events. | 0.1.0 |


#### LDMultiKindContext

A context made of several kinds: `{ kind: 'multi', user: {...}, organization: {...} }`.
Each kind's object has no `kind` of its own.

| Prop       | Type                 | Since |
| ---------- | -------------------- | ----- |
| **`kind`** | <code>'multi'</code> | 0.1.0 |


#### LDFlagSet


#### InitializeOptions

| Prop               | Type                                                                | Description                                                              | Since |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----- |
| **`mobileKey`**    | <code>string</code>                                                 | The mobile key of the LaunchDarkly environment, used on iOS and Android. | 0.1.0 |
| **`clientSideId`** | <code>string</code>                                                 | The client-side ID of the LaunchDarkly environment, used on the web.     | 0.1.0 |
| **`context`**      | <code><a href="#ldcontext">LDContext</a></code>                     |                                                                          | 0.1.0 |
| **`options`**      | <code><a href="#launchdarklyoptions">LaunchDarklyOptions</a></code> |                                                                          | 0.1.0 |


#### LaunchDarklyOptions

| Prop                    | Type                                                              | Description                                                                                                                                                                                                                                                                                                                                                 | Default            | Since |
| ----------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----- |
| **`streaming`**         | <code>boolean</code>                                              | Streams flag updates when `true`, polls when `false`.                                                                                                                                                                                                                                                                                                       | <code>true</code>  | 0.1.0 |
| **`evaluationReasons`** | <code>boolean</code>                                              | Asks LaunchDarkly for the reason behind each evaluation. The SDKs then attach it to their evaluation events.                                                                                                                                                                                                                                                | <code>false</code> | 0.1.0 |
| **`offline`**           | <code>boolean</code>                                              | Starts the client offline: it answers cached or default values and does not connect until `setOnline({ online: true })`. The web SDK has no offline mode: there `offline: true` starts without a stream, and the first flags are still fetched once.                                                                                                        | <code>false</code> | 0.1.0 |
| **`startWaitSeconds`**  | <code>number</code>                                               | How long the start waits for the first set of flags, in seconds.                                                                                                                                                                                                                                                                                            | <code>5</code>     | 0.1.0 |
| **`application`**       | <code><a href="#ldapplicationinfo">LDApplicationInfo</a></code>   | Application metadata sent to LaunchDarkly with every request. It describes the app; it is not a context, and adds nothing to the contexts counted for billing.                                                                                                                                                                                              |                    | 0.1.0 |
| **`bootstrap`**         | <code>'localStorage' \| <a href="#ldflagset">LDFlagSet</a></code> | Web only: flags to start with before LaunchDarkly answers. `'localStorage'` starts from the flags the web SDK cached in `localStorage` for the context on an earlier visit, which the SDK does on its own; a flag object (for example rendered by your server) starts from those values. The native SDKs always start from their own cache and ignore this. |                    | 0.1.0 |


#### LDApplicationInfo

| Prop              | Type                | Since |
| ----------------- | ------------------- | ----- |
| **`id`**          | <code>string</code> | 0.1.0 |
| **`name`**        | <code>string</code> | 0.1.0 |
| **`version`**     | <code>string</code> | 0.1.0 |
| **`versionName`** | <code>string</code> | 0.1.0 |


#### WaitForInitializationResult

| Prop              | Type                 | Since |
| ----------------- | -------------------- | ----- |
| **`initialized`** | <code>boolean</code> | 0.1.0 |


#### WaitForInitializationOptions

| Prop                 | Type                | Default        | Since |
| -------------------- | ------------------- | -------------- | ----- |
| **`timeoutSeconds`** | <code>number</code> | <code>5</code> | 0.1.0 |


#### IdentifyResult

| Prop           | Type                 | Description                                                                                                                                   | Since |
| -------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **`timedOut`** | <code>boolean</code> | `true` when the flags of the new context did not arrive in time. The context is switched all the same, and the flags follow when they arrive. | 0.1.0 |


#### IdentifyOptions

| Prop                 | Type                                            | Description                                                    | Default        | Since |
| -------------------- | ----------------------------------------------- | -------------------------------------------------------------- | -------------- | ----- |
| **`context`**        | <code><a href="#ldcontext">LDContext</a></code> |                                                                |                | 0.1.0 |
| **`timeoutSeconds`** | <code>number</code>                             | How long to wait for the flags of the new context, in seconds. | <code>5</code> | 0.1.0 |


#### VariationResult

| Prop        | Type                 | Since |
| ----------- | -------------------- | ----- |
| **`value`** | <code>unknown</code> | 0.1.0 |


#### VariationOptions

| Prop               | Type                 | Default           | Since |
| ------------------ | -------------------- | ----------------- | ----- |
| **`key`**          | <code>string</code>  |                   | 0.1.0 |
| **`defaultValue`** | <code>unknown</code> | <code>null</code> | 0.1.0 |


#### AllFlagsResult

| Prop        | Type                                            | Since |
| ----------- | ----------------------------------------------- | ----- |
| **`flags`** | <code><a href="#ldflagset">LDFlagSet</a></code> | 0.1.0 |


#### SetStreamingOptions

| Prop          | Type                 | Since |
| ------------- | -------------------- | ----- |
| **`enabled`** | <code>boolean</code> | 0.1.0 |


#### SetOnlineOptions

| Prop         | Type                 | Since |
| ------------ | -------------------- | ----- |
| **`online`** | <code>boolean</code> | 0.1.0 |


#### PluginListenerHandle

| Prop         | Type                                      |
| ------------ | ----------------------------------------- |
| **`remove`** | <code>() =&gt; Promise&lt;void&gt;</code> |


#### FlagChange

| Prop           | Type                 | Description                                            | Since |
| -------------- | -------------------- | ------------------------------------------------------ | ----- |
| **`key`**      | <code>string</code>  |                                                        | 0.1.0 |
| **`value`**    | <code>unknown</code> | The new value; `null` when the flag was deleted.       | 0.1.0 |
| **`previous`** | <code>unknown</code> | The value before the change, when the plugin knew one. | 0.1.0 |


#### ConnectionModeChange

| Prop       | Type                | Description                                                                                                                                                                                                                                                                               | Since |
| ---------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **`mode`** | <code>string</code> | The SDK's own name for the mode, which differs between the platforms: on iOS `streaming`, `polling`, `offline` or `establishingStreamingConnection`; on Android the name of the SDK's `ConnectionMode`, such as `STREAMING`, `POLLING`, `OFFLINE`, `SET_OFFLINE` or `BACKGROUND_POLLING`. | 0.1.0 |


### Type Aliases


#### LDContext

A context in the JSON shape LaunchDarkly's SDKs use: a single-kind context
or a multi-context.

<code><a href="#ldsinglekindcontext">LDSingleKindContext</a> | <a href="#ldmultikindcontext">LDMultiKindContext</a></code>

</docgen-api>

## Testing

```bash
npm run test:unit      # TypeScript: native calls reach the native plugin; the web implementation against a stand-in browser SDK
npm run test:parity    # the API, the web, the Swift, the Kotlin and this README name the same methods and the same config keys
npm run test:android   # JUnit on the JVM: config parsing, stored-context precedence, the SDK config, contexts and values
npm run test:ios       # XCTest on a simulator: the same on iOS, and the privacy manifest
```

The billing rules are tested against the SDKs themselves, not only against the plugin's settings. On Android a test runs the
SDK's own `AnonymousKeyContextModifier`, the step `LDClient.init` and `identify` apply to every context, with the plugin's
configuration, and checks that `anonymous_user` comes out unchanged, with a control that turns generation on and sees the key
replaced. On iOS the tests decode contexts with the SDK's decoder and check the key and the `anonymous` attribute of single and
multi-contexts. On both, the auto-start path is tested to build a configuration with environment attributes off.

What the tests do not reach is LaunchDarkly itself: start the example app with a real mobile key to see flags arrive.

## Example app

`example-app/` installs the plugin from this repository and has a button for every method. It commits no key: type the mobile key
(or, in a browser, the client-side ID) into the field, or set `LAUNCHDARKLY_MOBILE_KEY` when you sync to try the native
start-up:

```bash
cd example-app
npm install
LAUNCHDARKLY_MOBILE_KEY=mob-… npx cap sync
```

## License

MIT
