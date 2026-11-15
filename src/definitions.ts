import type { PluginsConfig } from '@capacitor/cli';
import type { PluginListenerHandle } from '@capacitor/core';

declare module '@capacitor/cli' {
  export interface PluginsConfig {
    /**
     * Starts the native LaunchDarkly client as the app launches, before the
     * web view runs any app code. Leave `mobileKey` out to start it from
     * JavaScript with `initialize()` instead. iOS and Android only.
     */
    LaunchDarkly?: {
      /**
       * The mobile key of the LaunchDarkly environment. Without it there is
       * no native start-up, and `initialize()` starts the client instead.
       *
       * @since 0.1.0
       * @example "mob-00000000-0000-0000-0000-000000000000"
       */
      mobileKey?: string;

      /**
       * The context the native start-up uses when no context was stored by an
       * earlier `identify()`.
       *
       * @since 0.1.0
       * @default { kind: 'user', key: 'anonymous_user', anonymous: true }
       * @example { "kind": "user", "key": "anonymous_user", "anonymous": true }
       */
      initialContext?: LDContext;

      /**
       * Streams flag updates when `true`, polls when `false`.
       *
       * @since 0.1.0
       * @default true
       * @example true
       */
      streaming?: boolean;

      /**
       * Asks LaunchDarkly for the reason behind each evaluation.
       *
       * @since 0.1.0
       * @default false
       * @example false
       */
      evaluationReasons?: boolean;

      /**
       * Starts the client offline, until `setOnline({ online: true })`.
       *
       * @since 0.1.0
       * @default false
       * @example false
       */
      offline?: boolean;

      /**
       * How long the start waits for the first set of flags, in seconds.
       *
       * @since 0.1.0
       * @default 5
       * @example 5
       */
      startWaitSeconds?: number;

      /**
       * Application metadata sent to LaunchDarkly with every request.
       *
       * @since 0.1.0
       * @example { "id": "com.example.plugin", "version": "1.0.0" }
       */
      application?: LDApplicationInfo;
    };
  }
}

/**
 * The `plugins.LaunchDarkly` block of `capacitor.config`.
 */
export type LaunchDarklyConfig = NonNullable<PluginsConfig['LaunchDarkly']>;

export interface LaunchDarklyPlugin {
  /**
   * Starts the client from JavaScript and waits for the first set of flags or
   * `options.startWaitSeconds` (5 by default), whichever comes first.
   *
   * - **iOS, Android**: takes `mobileKey`. Needed only by an app that does not
   *   put a `mobileKey` in `capacitor.config`; with one there, the client is
   *   already running when the app's code starts, and this call only answers
   *   its state.
   * - **Web**: takes `clientSideId`, and is the only way to start the client.
   *   Needs `@launchdarkly/js-client-sdk` installed (see the README).
   *
   * `context` plays the part of `initialContext`: when an earlier `identify()`
   * stored a context, the client starts with the stored one instead, so the
   * app does not flip to an anonymous context for a moment after a restart.
   *
   * There is one client per process (per page on the web). A second call with
   * the same key, or a call after the native start-up already started a
   * client with that key, changes nothing: the client is not created again,
   * `context` and `options` are ignored, and the current state is answered.
   * Use `identify()` to switch the context. A call with a different key closes
   * the running client and starts a new one.
   *
   * @since 0.1.0
   */
  initialize(options: InitializeOptions): Promise<LaunchDarklyState>;

  /**
   * Answers whether the client has received its first set of flags, waiting
   * up to `timeoutSeconds` (5 by default) for that when it has not yet.
   *
   * Resolves `{ initialized: false }` straight away when no client was
   * started, neither natively nor with `initialize()`.
   *
   * @since 0.1.0
   */
  waitForInitialization(options?: WaitForInitializationOptions): Promise<WaitForInitializationResult>;

  /**
   * The state of the native client: whether it has its flags, the current
   * context and the value of every flag, read from the native SDK's own
   * store. Meant for bootstrapping the web layer at start without a second
   * network round trip.
   *
   * While the native start-up is still running, this waits until it is done:
   * until the first set of flags is in, or `startWaitSeconds` has passed.
   * With no client at all it answers `initialized: false` and no flags.
   *
   * Reading the flags this way sends no evaluation events.
   *
   * @since 0.1.0
   */
  getState(): Promise<LaunchDarklyState>;

  /**
   * Switches the client to another context and resolves when the flags for
   * it are loaded, or when `timeoutSeconds` (5 by default) has passed.
   *
   * The context the SDK accepted is stored natively, under a key of the
   * plugin's own, and the next native start-up begins with it instead of
   * `initialContext`. So an app logs out by identifying its anonymous
   * context, which then becomes the stored one; `clearStoredContext()`
   * forgets it altogether.
   *
   * An anonymous context keeps the key it is given. The plugin never asks the
   * SDK to generate one.
   *
   * @since 0.1.0
   */
  identify(options: IdentifyOptions): Promise<IdentifyResult>;

  /**
   * Evaluates one flag for the current context and answers its value, of any
   * JSON type, or `defaultValue` (`null` when left out) when the flag is
   * unknown or the client has not started. Goes through the SDK's JSON
   * variation call, so it records an evaluation event like any SDK call.
   *
   * @since 0.1.0
   */
  variation(options: VariationOptions): Promise<VariationResult>;

  /**
   * The value of every flag for the current context, from the native SDK's
   * store. Sends no evaluation events. Empty when the client has not started.
   *
   * @since 0.1.0
   */
  allFlags(): Promise<AllFlagsResult>;

  /**
   * Switches between streaming and polling. Neither native SDK can change its
   * data source while it runs, so the plugin closes the client and starts it
   * again with the same mobile key, options and current context, then waits as
   * at start-up. Flag listeners stay registered. The web SDK switches in place
   * (`setStreaming()`).
   *
   * @since 0.1.0
   */
  setStreaming(options: SetStreamingOptions): Promise<void>;

  /**
   * Takes the client online or offline (`setOnline()` / `setOffline()` on
   * Android, `setOnline(_:)` on iOS). Offline, the client keeps answering the
   * values it has.
   *
   * The web SDK has no offline mode. There, going offline closes the stream so
   * no flag updates arrive, and going online opens it again if `streaming` is
   * on; analytics events are still sent.
   *
   * @since 0.1.0
   */
  setOnline(options: SetOnlineOptions): Promise<void>;

  /**
   * Sends the analytics events the client has queued.
   *
   * @since 0.1.0
   */
  flush(): Promise<void>;

  /**
   * Closes the client. It can be started again with `initialize()`; until
   * then, `variation()` answers the default value. The stored context is
   * kept.
   *
   * @since 0.1.0
   */
  close(): Promise<void>;

  /**
   * Forgets the context `identify()` stored, so the next native start-up
   * begins with `initialContext` again. The running client is not changed.
   *
   * @since 0.1.0
   */
  clearStoredContext(): Promise<void>;

  /**
   * Called for every flag whose value changes: from the stream or a poll, and
   * after `identify()` for each flag whose value differs for the new context.
   *
   * @since 0.1.0
   */
  addListener(eventName: 'flagChange', listenerFunc: (change: FlagChange) => void): Promise<PluginListenerHandle>;

  /**
   * Called when the SDK's connection mode changes, for example from streaming
   * to offline. iOS and Android only: the web SDK has no connection mode, and
   * this is never called there.
   *
   * @since 0.1.0
   */
  addListener(
    eventName: 'connectionModeChange',
    listenerFunc: (change: ConnectionModeChange) => void,
  ): Promise<PluginListenerHandle>;

  /**
   * Removes every listener of this plugin.
   *
   * @since 0.1.0
   */
  removeAllListeners(): Promise<void>;
}

export interface LaunchDarklyOptions {
  /**
   * Streams flag updates when `true`, polls when `false`.
   *
   * @since 0.1.0
   * @default true
   */
  streaming?: boolean;

  /**
   * Asks LaunchDarkly for the reason behind each evaluation. The SDKs then
   * attach it to their evaluation events.
   *
   * @since 0.1.0
   * @default false
   */
  evaluationReasons?: boolean;

  /**
   * Starts the client offline: it answers cached or default values and does
   * not connect until `setOnline({ online: true })`.
   *
   * The web SDK has no offline mode: there `offline: true` starts without a
   * stream, and the first flags are still fetched once.
   *
   * @since 0.1.0
   * @default false
   */
  offline?: boolean;

  /**
   * How long the start waits for the first set of flags, in seconds.
   *
   * @since 0.1.0
   * @default 5
   */
  startWaitSeconds?: number;

  /**
   * Application metadata sent to LaunchDarkly with every request. It
   * describes the app; it is not a context, and adds nothing to the contexts
   * counted for billing.
   *
   * @since 0.1.0
   */
  application?: LDApplicationInfo;

  /**
   * Web only: flags to start with before LaunchDarkly answers. `'localStorage'`
   * starts from the flags the web SDK cached in `localStorage` for the context
   * on an earlier visit, which the SDK does on its own; a flag object (for
   * example rendered by your server) starts from those values. The native
   * SDKs always start from their own cache and ignore this.
   *
   * @since 0.1.0
   */
  bootstrap?: 'localStorage' | LDFlagSet;
}

export interface LDApplicationInfo {
  /**
   * @since 0.1.0
   */
  id?: string;

  /**
   * @since 0.1.0
   */
  name?: string;

  /**
   * @since 0.1.0
   */
  version?: string;

  /**
   * @since 0.1.0
   */
  versionName?: string;
}

export interface InitializeOptions {
  /**
   * The mobile key of the LaunchDarkly environment, used on iOS and Android.
   *
   * @since 0.1.0
   */
  mobileKey?: string;

  /**
   * The client-side ID of the LaunchDarkly environment, used on the web.
   *
   * @since 0.1.0
   */
  clientSideId?: string;

  /**
   * @since 0.1.0
   */
  context: LDContext;

  /**
   * @since 0.1.0
   */
  options?: LaunchDarklyOptions;
}

/**
 * A context in the JSON shape LaunchDarkly's SDKs use: a single-kind context
 * or a multi-context.
 */
export type LDContext = LDSingleKindContext | LDMultiKindContext;

/**
 * A context of one kind. Any other property is a custom attribute: a string,
 * number, boolean, array or object.
 */
export interface LDSingleKindContext {
  /**
   * The context kind, for example `user` or `organization`.
   *
   * @since 0.1.0
   */
  kind: string;

  /**
   * The key. An anonymous context keeps the key it is given.
   *
   * @since 0.1.0
   */
  key: string;

  /**
   * @since 0.1.0
   */
  name?: string;

  /**
   * Leaves the context out of the dashboard's context list. It is still
   * counted for billing by its key.
   *
   * @since 0.1.0
   */
  anonymous?: boolean;

  /**
   * @since 0.1.0
   */
  _meta?: LDContextMeta;

  [attribute: string]: unknown;
}

/**
 * One kind of a multi-context: the attributes of `LDSingleKindContext` without
 * `kind`, which is the property name in the multi-context.
 */
export interface LDContextCommon {
  /**
   * @since 0.1.0
   */
  key: string;

  /**
   * @since 0.1.0
   */
  name?: string;

  /**
   * @since 0.1.0
   */
  anonymous?: boolean;

  /**
   * @since 0.1.0
   */
  _meta?: LDContextMeta;

  [attribute: string]: unknown;
}

export interface LDContextMeta {
  /**
   * Attributes, by name or `/`-separated reference, that are not sent to
   * LaunchDarkly in analytics events.
   *
   * @since 0.1.0
   */
  privateAttributes?: string[];
}

/**
 * A context made of several kinds: `{ kind: 'multi', user: {...}, organization: {...} }`.
 * Each kind's object has no `kind` of its own.
 */
export interface LDMultiKindContext {
  /**
   * @since 0.1.0
   */
  kind: 'multi';

  [contextKind: string]: 'multi' | LDContextCommon;
}

export interface LDFlagSet {
  [flagKey: string]: unknown;
}

export interface LaunchDarklyState {
  /**
   * Whether the client has received its first set of flags, from the network
   * or, when it was started offline, from its cache.
   *
   * @since 0.1.0
   */
  initialized: boolean;

  /**
   * The current context. Absent when no client was started.
   *
   * @since 0.1.0
   */
  context?: LDContext;

  /**
   * The value of every flag for the current context.
   *
   * @since 0.1.0
   */
  flags: LDFlagSet;
}

export interface WaitForInitializationOptions {
  /**
   * @since 0.1.0
   * @default 5
   */
  timeoutSeconds?: number;
}

export interface WaitForInitializationResult {
  /**
   * @since 0.1.0
   */
  initialized: boolean;
}

export interface IdentifyOptions {
  /**
   * @since 0.1.0
   */
  context: LDContext;

  /**
   * How long to wait for the flags of the new context, in seconds.
   *
   * @since 0.1.0
   * @default 5
   */
  timeoutSeconds?: number;
}

export interface IdentifyResult {
  /**
   * `true` when the flags of the new context did not arrive in time. The
   * context is switched all the same, and the flags follow when they arrive.
   *
   * @since 0.1.0
   */
  timedOut: boolean;
}

export interface VariationOptions {
  /**
   * @since 0.1.0
   */
  key: string;

  /**
   * @since 0.1.0
   * @default null
   */
  defaultValue?: unknown;
}

export interface VariationResult {
  /**
   * @since 0.1.0
   */
  value: unknown;
}

export interface AllFlagsResult {
  /**
   * @since 0.1.0
   */
  flags: LDFlagSet;
}

export interface SetStreamingOptions {
  /**
   * @since 0.1.0
   */
  enabled: boolean;
}

export interface SetOnlineOptions {
  /**
   * @since 0.1.0
   */
  online: boolean;
}

export interface FlagChange {
  /**
   * @since 0.1.0
   */
  key: string;

  /**
   * The new value; `null` when the flag was deleted.
   *
   * @since 0.1.0
   */
  value: unknown;

  /**
   * The value before the change, when the plugin knew one.
   *
   * @since 0.1.0
   */
  previous?: unknown;
}

export interface ConnectionModeChange {
  /**
   * The SDK's own name for the mode, which differs between the platforms:
   * on iOS `streaming`, `polling`, `offline` or
   * `establishingStreamingConnection`; on Android the name of the SDK's
   * `ConnectionMode`, such as `STREAMING`, `POLLING`, `OFFLINE`,
   * `SET_OFFLINE` or `BACKGROUND_POLLING`.
   *
   * @since 0.1.0
   */
  mode: string;
}
