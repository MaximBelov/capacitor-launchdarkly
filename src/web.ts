import { WebPlugin } from '@capacitor/core';
import type { LDClient, LDOptions } from '@launchdarkly/js-client-sdk';

import type {
  AllFlagsResult,
  IdentifyOptions,
  IdentifyResult,
  InitializeOptions,
  LaunchDarklyOptions,
  LaunchDarklyPlugin,
  LaunchDarklyState,
  LDContext,
  LDFlagSet,
  SetOnlineOptions,
  SetStreamingOptions,
  VariationOptions,
  VariationResult,
  WaitForInitializationOptions,
  WaitForInitializationResult,
} from './definitions';

/** The part of `@launchdarkly/js-client-sdk` the plugin uses. */
export interface WebSdk {
  createClient(clientSideId: string, context: LDContext, options?: LDOptions): LDClient;
}

/** The key the plugin keeps the context of the last `identify()` under in `localStorage`. */
export const STORED_CONTEXT_KEY = 'CapacitorLaunchDarkly.context';

const DEFAULT_WAIT_SECONDS = 5;

/** The most `initialize()` and `getState()` wait for the browser SDK to read its localStorage cache. */
export const CACHE_READ_MS = 100;

export const MISSING_SDK_MESSAGE =
  'The LaunchDarkly web SDK is not installed. To use this plugin on the web, run: npm install @launchdarkly/js-client-sdk';

// Imported only when a web app starts the client, so a native-only app never loads it.
const importSdk = (): Promise<WebSdk> => import('@launchdarkly/js-client-sdk');

/**
 * The web implementation, on LaunchDarkly's browser SDK. It follows the native rules: one client per page, a context the
 * caller gave with its key (an anonymous context without a key is refused rather than given a generated one), and a context
 * stored by `identify()` that wins over the one `initialize()` is given.
 */
export class LaunchDarklyWeb extends WebPlugin implements LaunchDarklyPlugin {
  private client?: LDClient;
  private clientSideId?: string;
  private options: LaunchDarklyOptions = {};
  private context?: LDContext;
  /** Whether LaunchDarkly answered since this client was started. */
  private answered = false;
  /** Settles once the browser SDK has read its cache (or after CACHE_READ_MS). Never waits for the network. */
  private cacheRead?: Promise<void>;
  private lastValues: LDFlagSet = {};

  constructor(private readonly loadSdk: () => Promise<WebSdk> = importSdk) {
    super();
  }

  async initialize(options: InitializeOptions): Promise<LaunchDarklyState> {
    const clientSideId = options?.clientSideId;
    if (!clientSideId) throw new Error('initialize needs a clientSideId on the web.');
    if (this.clientSideId === clientSideId) {
      await this.cacheRead;
      return this.state();
    }
    requireKeys(options.context);
    const sdk = await this.sdk();
    if (this.client) await this.close();

    const startOptions = options.options ?? {};
    // The given context plays the part of initialContext: a context an earlier identify() stored wins over it.
    const context = readStoredContext() ?? options.context;
    const streaming = (startOptions.streaming ?? true) && !startOptions.offline;
    const client = sdk.createClient(clientSideId, context, {
      streaming,
      withReasons: startOptions.evaluationReasons ?? false,
      ...(startOptions.application ? { applicationInfo: startOptions.application } : {}),
    });
    this.client = client;
    this.clientSideId = clientSideId;
    this.options = startOptions;
    this.context = context;
    this.answered = false;
    let firstChange!: () => void;
    const changed = new Promise<void>((resolve) => (firstChange = resolve));
    client.on('change', (_context: unknown, keys: string[]) => {
      firstChange();
      this.flagsChanged(client, keys);
    });

    const bootstrap = startOptions.bootstrap;
    // Not awaited: start() settles when LaunchDarkly answers or its timeout passes, and nothing here waits for the network.
    const started = client
      .start({
        timeout: seconds(startOptions.startWaitSeconds),
        // 'localStorage' is the SDK's own behaviour: it starts from the flags it cached for the context.
        ...(bootstrap && bootstrap !== 'localStorage' ? { bootstrap } : {}),
      })
      .then(
        (result) => {
          if (this.client === client && result.status === 'complete') this.answered = true;
        },
        () => undefined,
      );
    // The browser SDK reads its localStorage cache asynchronously (FlagPersistence.loadCached), and announces the flags it
    // found with a 'change' event. The cache read is local, so this waits for it at most CACHE_READ_MS, never for the network.
    this.cacheRead = Promise.race([changed, started, delay(CACHE_READ_MS)]).then(() => {
      if (this.client === client) this.lastValues = { ...client.allFlags() };
    });
    await this.cacheRead;
    return this.state();
  }

  async waitForInitialization(options?: WaitForInitializationOptions): Promise<WaitForInitializationResult> {
    const client = this.client;
    if (!client) return { initialized: false, timedOut: false };
    if (!this.answered) {
      const timeout = seconds(options?.timeoutSeconds ?? this.options.startWaitSeconds);
      // The SDK's own wait has a timeout too; the race only makes sure this cannot outlive the one asked for.
      const result = await Promise.race([
        client.waitForInitialization({ timeout }).catch(() => ({ status: 'failed' as const })),
        delay(timeout * 1000).then(() => ({ status: 'timeout' as const })),
      ]);
      if (this.client === client && result.status === 'complete') this.answered = true;
    }
    return { initialized: this.answered, timedOut: !this.answered };
  }

  async getState(): Promise<LaunchDarklyState> {
    await this.cacheRead;
    return this.state();
  }

  async identify(options: IdentifyOptions): Promise<IdentifyResult> {
    const client = this.started();
    requireKeys(options?.context);
    // Stored first: the SDK switches to the context (and to its cached flags) whether or not LaunchDarkly answers.
    this.context = options.context;
    writeStoredContext(options.context);
    const timeout = seconds(options.timeoutSeconds);
    const result = await Promise.race([
      client.identify(options.context, { timeout }).catch(() => ({ status: 'error' as const })),
      delay(timeout * 1000).then(() => ({ status: 'timeout' as const })),
    ]);
    if (result.status === 'completed') {
      if (this.client === client) this.answered = true;
      return { timedOut: false };
    }
    // 'timeout', 'error' (a failed request, the usual offline answer) and 'shed' (a later identify replaced it): the flags
    // did not arrive, which is not a failure of the call.
    return { timedOut: true };
  }

  async variation(options: VariationOptions): Promise<VariationResult> {
    const defaultValue = options.defaultValue ?? null;
    const value = this.client ? this.client.jsonVariation(options.key, defaultValue) : defaultValue;
    return { value: value ?? null };
  }

  async allFlags(): Promise<AllFlagsResult> {
    return { flags: this.client ? { ...this.client.allFlags() } : {} };
  }

  async setStreaming(options: SetStreamingOptions): Promise<void> {
    const client = this.started();
    this.options = { ...this.options, streaming: options.enabled };
    client.setStreaming(options.enabled);
  }

  async setOnline(options: SetOnlineOptions): Promise<void> {
    // The browser SDK has no offline mode: offline closes the stream, online opens it again when streaming is on.
    const client = this.started();
    client.setStreaming(options.online ? (this.options.streaming ?? true) : false);
  }

  async flush(): Promise<void> {
    await this.client?.flush();
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.clientSideId = undefined;
    this.context = undefined;
    this.answered = false;
    this.cacheRead = undefined;
    this.lastValues = {};
    await client?.close();
  }

  async clearStoredContext(): Promise<void> {
    try {
      localStorage.removeItem(STORED_CONTEXT_KEY);
    } catch {
      // No storage (a private window, blocked site data): nothing was stored either.
    }
  }

  private async sdk(): Promise<WebSdk> {
    try {
      return await this.loadSdk();
    } catch (error) {
      throw new Error(`${MISSING_SDK_MESSAGE} (${error instanceof Error ? error.message : String(error)})`, {
        cause: error,
      });
    }
  }

  private started(): LDClient {
    if (!this.client) throw new Error('The client is not started.');
    return this.client;
  }

  private state(): LaunchDarklyState {
    const flags = this.client ? { ...this.client.allFlags() } : {};
    const source = this.answered ? 'network' : Object.keys(flags).length > 0 ? 'cache' : 'none';
    return {
      initialized: this.answered,
      source,
      flags,
      ...(this.context ? { context: this.context } : {}),
    };
  }

  private flagsChanged(client: LDClient, keys: string[]) {
    if (this.client !== client) return;
    const flags = client.allFlags();
    for (const key of keys) {
      const value = key in flags ? flags[key] : null;
      const hadPrevious = key in this.lastValues;
      const previous = this.lastValues[key];
      if (key in flags) this.lastValues[key] = flags[key];
      else delete this.lastValues[key];
      this.notifyListeners('flagChange', hadPrevious ? { key, value, previous } : { key, value });
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seconds(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_WAIT_SECONDS;
}

/**
 * Refuses a context whose key (or the key of any kind in a multi-context) is missing or empty. The browser SDK would generate
 * one for an anonymous context, stored per browser, and every browser would then count as a context of its own.
 */
export function requireKeys(context: LDContext | undefined): void {
  if (!context || typeof context !== 'object') throw new Error('A context is needed.');
  const parts: [string, unknown][] =
    context.kind === 'multi'
      ? Object.entries(context).filter(([kind]) => kind !== 'kind')
      : [[String(context.kind ?? 'user'), context]];
  if (parts.length === 0) throw new Error('Invalid context: a multi-context needs at least one kind.');
  for (const [kind, part] of parts) {
    const key = (part as { key?: unknown } | null)?.key;
    if (typeof key !== 'string' || key === '') {
      throw new Error(`Invalid context: the ${kind} context has no key. Pass one, also for an anonymous context.`);
    }
  }
}

function readStoredContext(): LDContext | undefined {
  try {
    const json = localStorage.getItem(STORED_CONTEXT_KEY);
    if (!json) return undefined;
    const context = JSON.parse(json) as LDContext;
    requireKeys(context);
    return context;
  } catch {
    return undefined;
  }
}

function writeStoredContext(context: LDContext): void {
  try {
    localStorage.setItem(STORED_CONTEXT_KEY, JSON.stringify(context));
  } catch {
    // No storage: the next start begins with the context initialize() is given.
  }
}
