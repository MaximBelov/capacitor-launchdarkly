package io.github.maximbelov.launchdarkly

import android.app.Application
import com.launchdarkly.sdk.LDValue
import com.launchdarkly.sdk.android.ConnectionInformation
import com.launchdarkly.sdk.android.LDAllFlagsListener
import com.launchdarkly.sdk.android.LDClient
import com.launchdarkly.sdk.android.LDFailure
import com.launchdarkly.sdk.android.LDStatusListener
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Where the client's events go: the plugin instance of the current bridge. */
interface ClientEvents {
    fun flagChanged(key: String, value: LDValue?, previous: LDValue?)
    fun connectionModeChanged(mode: String)
}

/** [FlagReader] over the real client. */
private class SdkReader(private val client: LDClient) : FlagReader {
    override fun allFlags(): Map<String, LDValue> = client.allFlags()
    override fun lastSuccessfulConnection(): Long? = client.connectionInformation?.lastSuccessfulConnection
}

/**
 * The one LaunchDarkly client of the process. It outlives a plugin instance, since an activity that is recreated creates a new
 * bridge and a new plugin, while the SDK keeps one client per process.
 *
 * Offline first: nothing here waits for the network unless the caller asked to (`waitForInitialization`, the timeout of
 * `identify`). The client is created with a start wait of zero, so `LDClient.init` returns as soon as the client exists, with
 * the flags it cached for the context already in its store, and the network answer arrives later as `flagChange` events.
 *
 * Starting, restarting, identifying and closing run one after another on [lifecycle], in the order they were asked for, so the
 * plugin's `load()` never blocks the main thread. What waits (for the client to exist, for LaunchDarkly to answer) runs on
 * [waiters], so a wait never holds up Capacitor's plugin thread or the lifecycle.
 */
object LaunchDarklyClient {
    private val lifecycle: ExecutorService = Executors.newSingleThreadExecutor { Thread(it, "LaunchDarklyLifecycle") }
    private val waiters: ExecutorService = Executors.newCachedThreadPool { Thread(it, "LaunchDarklyWait").apply { isDaemon = true } }

    @Volatile var events: ClientEvents? = null

    private val lock = Any()
    private var client: LDClient? = null
    private var options: StartOptions? = null
    private var contextJson: String? = null
    private var created: CountDownLatch? = null
    private var startedAtMillis = 0L
    private val lastValues = HashMap<String, LDValue>()

    private val flagsListener = LDAllFlagsListener { keys -> onFlagsChanged(keys) }
    private val statusListener = object : LDStatusListener {
        override fun onConnectionModeChanged(connectionInformation: ConnectionInformation) {
            events?.connectionModeChanged(connectionInformation.connectionMode.name)
        }

        override fun onInternalFailure(ldFailure: LDFailure?) = Unit
    }

    /** The mobile key of the running client, or of the one being created. */
    val mobileKey: String? get() = synchronized(lock) { options?.mobileKey }

    /** The options of the running client, or of the one being created. */
    val startOptions: StartOptions? get() = synchronized(lock) { options }

    /**
     * Creates the client unless one with the same mobile key is running or being created; one with another key is closed
     * first. [done] runs on a waiter thread once the client exists, which takes milliseconds and never waits for the network.
     */
    fun start(application: Application, options: StartOptions, context: ContextChoice, done: () -> Unit = {}) {
        val latch = synchronized(lock) {
            if (this.options?.mobileKey == options.mobileKey && created != null) {
                created!!
            } else {
                val latch = CountDownLatch(1)
                val previous = this.options
                this.options = options
                this.contextJson = context.json
                this.created = latch
                lifecycle.execute { startNow(application, options, context, latch, closeFirst = previous != null) }
                latch
            }
        }
        waiters.execute {
            awaitCreated(latch)
            done()
        }
    }

    private fun startNow(application: Application, options: StartOptions, context: ContextChoice, latch: CountDownLatch, closeFirst: Boolean) {
        try {
            if (closeFirst) closeNow()
            val startedAt = System.currentTimeMillis()
            // A start wait of zero: init returns the client at once, its store already holding the flags cached for the context
            // (the LDClient constructor builds a ContextDataManager, which loads them before the data source starts).
            val newClient = LDClient.init(application, LdConfigFactory.build(options), context.context, 0)
            newClient.registerAllFlagsListener(flagsListener)
            newClient.registerStatusListener(statusListener)
            synchronized(lock) {
                client = newClient
                startedAtMillis = startedAt
                lastValues.clear()
                lastValues.putAll(newClient.allFlags())
            }
        } finally {
            latch.countDown()
        }
    }

    /** Recreates the running client with [change] applied to its options, keeping the current context. */
    fun restart(application: Application, change: (StartOptions) -> StartOptions, done: (Exception?) -> Unit) {
        val (current, json) = synchronized(lock) { options to contextJson }
        if (current == null || json == null) {
            done(IllegalStateException("The client is not started."))
            return
        }
        val context = try {
            ContextChoice(Contexts.parse(json), json)
        } catch (e: IllegalArgumentException) {
            done(e)
            return
        }
        val next = change(current)
        val latch = CountDownLatch(1)
        synchronized(lock) {
            options = next
            created = latch
        }
        lifecycle.execute { startNow(application, next, context, latch, closeFirst = true) }
        waiters.execute {
            awaitCreated(latch)
            done(null)
        }
    }

    /**
     * Switches the context, waiting at most [timeoutSeconds] for its flags. [done] gets whether they did not arrive from
     * LaunchDarkly in time (offline included), or an error only when there is no client. The SDK loads the new context's
     * cached flags into its store as it switches (`ContextDataManager.switchToContext`), before it asks the network.
     */
    fun identify(context: ContextChoice, timeoutSeconds: Double, store: ContextStore, done: (Boolean?, Exception?) -> Unit) {
        lifecycle.execute {
            val current = synchronized(lock) { client }
            if (current == null) {
                done(null, IllegalStateException("The client is not started."))
                return@execute
            }
            val startedAt = System.currentTimeMillis()
            val future = current.identify(context.context)
            synchronized(lock) { contextJson = context.json }
            store.write(context.json)
            done(IdentifyWait.timedOut(future, (timeoutSeconds * 1000).toLong(), startedAt, SdkReader(current)), null)
        }
    }

    /** Runs [answer] on a waiter thread once the client exists: milliseconds, never the network. */
    fun afterCreated(answer: () -> Unit) {
        val latch = synchronized(lock) { created }
        waiters.execute {
            if (latch != null) awaitCreated(latch)
            answer()
        }
    }

    /** Answers on a waiter thread whether LaunchDarkly answered in this process, waiting up to [timeoutSeconds] for it. */
    fun waitForInitialization(timeoutSeconds: Double, answer: (Boolean) -> Unit) {
        val latch = synchronized(lock) { created }
        if (latch == null) {
            answer(false)
            return
        }
        waiters.execute {
            val deadline = System.nanoTime() + (timeoutSeconds * 1_000_000_000).toLong()
            latch.await(remainingNanos(deadline).coerceAtLeast(0), TimeUnit.NANOSECONDS)
            while (true) {
                if (state().initialized) return@execute answer(true)
                if (remainingNanos(deadline) <= 0) return@execute answer(false)
                Thread.sleep(POLL_MILLIS)
            }
        }
    }

    /** The state now, from the SDK's store. Never waits. */
    fun state(): ClientState {
        val (current, startedAt, json) = synchronized(lock) { Triple(client, startedAtMillis, contextJson) }
        return StateReader.read(current?.let(::SdkReader), startedAt, json)
    }

    /** Every flag from the SDK's store; reading them this way records no evaluation event. */
    fun allFlags(): Map<String, LDValue> = synchronized(lock) { client }?.allFlags() ?: emptyMap()

    fun variation(key: String, defaultValue: LDValue): LDValue =
        synchronized(lock) { client }?.jsonValueVariation(key, defaultValue) ?: defaultValue

    fun setOnline(online: Boolean) {
        val current = synchronized(lock) { client } ?: return
        if (online) current.setOnline() else current.setOffline()
    }

    fun flush() {
        synchronized(lock) { client }?.flush()
    }

    fun close(done: () -> Unit) {
        synchronized(lock) {
            options = null
            created = null
            contextJson = null
        }
        lifecycle.execute {
            closeNow()
            done()
        }
    }

    private fun closeNow() {
        val current = synchronized(lock) {
            val c = client
            client = null
            lastValues.clear()
            c
        } ?: return
        current.unregisterAllFlagsListener(flagsListener)
        current.unregisterStatusListener(statusListener)
        try {
            current.close()
        } catch (e: Exception) {
            // close() declares IOException and never throws it; nothing to do either way.
        }
    }

    private fun onFlagsChanged(keys: List<String>) {
        val current = synchronized(lock) { client } ?: return
        val values = current.allFlags()
        for (key in keys) {
            val value = values[key]
            val previous = synchronized(lock) {
                val before = lastValues[key]
                if (value == null) lastValues.remove(key) else lastValues[key] = value
                before
            }
            events?.flagChanged(key, value, previous)
        }
    }

    private fun awaitCreated(latch: CountDownLatch) {
        // Creating the client is local work; the bound only guards against one that never returns.
        latch.await(CREATE_BOUND_SECONDS, TimeUnit.SECONDS)
    }

    private fun remainingNanos(deadline: Long) = deadline - System.nanoTime()

    private const val POLL_MILLIS = 50L
    private const val CREATE_BOUND_SECONDS = 10L
}
