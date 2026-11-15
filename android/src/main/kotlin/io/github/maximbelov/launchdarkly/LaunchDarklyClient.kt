package io.github.maximbelov.launchdarkly

import android.app.Application
import com.launchdarkly.sdk.LDValue
import com.launchdarkly.sdk.android.ConnectionInformation
import com.launchdarkly.sdk.android.LDAllFlagsListener
import com.launchdarkly.sdk.android.LDClient
import com.launchdarkly.sdk.android.LDFailure
import com.launchdarkly.sdk.android.LDStatusListener
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** Where the client's events go: the plugin instance of the current bridge. */
interface ClientEvents {
    fun flagChanged(key: String, value: LDValue?, previous: LDValue?)
    fun connectionModeChanged(mode: String)
}

/**
 * The one LaunchDarkly client of the process. It outlives a plugin instance, since an activity that is recreated creates a new
 * bridge and a new plugin, while the SDK keeps one client per process.
 *
 * Starting, restarting, identifying and closing run one after another on [lifecycle], in the order they were asked for. What
 * only waits (for the start to finish, for the first flags) runs on [waiters], so a wait never holds up Capacitor's plugin
 * thread or the lifecycle.
 */
object LaunchDarklyClient {
    private val lifecycle: ExecutorService = Executors.newSingleThreadExecutor { Thread(it, "LaunchDarklyLifecycle") }
    private val waiters: ExecutorService = Executors.newCachedThreadPool { Thread(it, "LaunchDarklyWait").apply { isDaemon = true } }

    @Volatile var events: ClientEvents? = null

    private val lock = Any()
    private var client: LDClient? = null
    private var options: StartOptions? = null
    private var contextJson: String? = null
    private var started: CountDownLatch? = null
    private val lastValues = HashMap<String, LDValue>()

    private val flagsListener = LDAllFlagsListener { keys -> onFlagsChanged(keys) }
    private val statusListener = object : LDStatusListener {
        override fun onConnectionModeChanged(connectionInformation: ConnectionInformation) {
            events?.connectionModeChanged(connectionInformation.connectionMode.name)
        }

        override fun onInternalFailure(ldFailure: LDFailure?) = Unit
    }

    /** The mobile key of the running client, or of the one being started. */
    val mobileKey: String? get() = synchronized(lock) { options?.mobileKey }

    /**
     * Starts the client unless one with the same mobile key is running or starting; one with another key is closed first.
     * [done] runs on a waiter thread once the start has finished: the first flags are in or the wait is over.
     */
    fun start(application: Application, options: StartOptions, context: ContextChoice, done: () -> Unit = {}) {
        val latch = synchronized(lock) {
            if (this.options?.mobileKey == options.mobileKey && started != null) {
                started!!
            } else {
                val latch = CountDownLatch(1)
                val previous = this.options
                this.options = options
                this.contextJson = context.json
                this.started = latch
                lifecycle.execute { startNow(application, options, context, latch, closeFirst = previous != null) }
                latch
            }
        }
        waiters.execute {
            awaitStart(latch, options)
            done()
        }
    }

    private fun startNow(application: Application, options: StartOptions, context: ContextChoice, latch: CountDownLatch, closeFirst: Boolean) {
        try {
            if (closeFirst) closeNow()
            // Blocks this lifecycle thread, not the caller, for at most startWaitSeconds; the client is usable either way.
            val newClient = LDClient.init(application, LdConfigFactory.build(options), context.context, options.startWaitWholeSeconds)
            newClient.registerAllFlagsListener(flagsListener)
            newClient.registerStatusListener(statusListener)
            synchronized(lock) {
                client = newClient
                lastValues.clear()
                lastValues.putAll(newClient.allFlags())
            }
        } finally {
            latch.countDown()
        }
    }

    /** Restarts the running client with [change] applied to its options, keeping the current context. */
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
            started = latch
        }
        lifecycle.execute { startNow(application, next, context, latch, closeFirst = true) }
        waiters.execute {
            awaitStart(latch, next)
            done(null)
        }
    }

    /** Switches the context; [done] gets whether the wait for its flags timed out, or the error. */
    fun identify(context: ContextChoice, timeoutSeconds: Double, store: ContextStore, done: (Boolean?, Exception?) -> Unit) {
        lifecycle.execute {
            val current = synchronized(lock) { client }
            if (current == null) {
                done(null, IllegalStateException("The client is not started."))
                return@execute
            }
            try {
                current.identify(context.context).get((timeoutSeconds * 1000).toLong(), TimeUnit.MILLISECONDS)
                remember(context, store)
                done(false, null)
            } catch (e: TimeoutException) {
                // The SDK has switched to the context and keeps loading its flags; only the wait is over.
                remember(context, store)
                done(true, null)
            } catch (e: ExecutionException) {
                done(null, (e.cause as? Exception) ?: e)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                done(null, e)
            }
        }
    }

    private fun remember(context: ContextChoice, store: ContextStore) {
        synchronized(lock) { contextJson = context.json }
        store.write(context.json)
    }

    /** Waits on a waiter thread until the start has finished, then answers. */
    fun afterStart(answer: () -> Unit) {
        val (latch, current) = synchronized(lock) { started to options }
        waiters.execute {
            if (latch != null && current != null) awaitStart(latch, current)
            answer()
        }
    }

    /** Answers on a waiter thread whether the client has its first flags, waiting up to [timeoutSeconds] for them. */
    fun waitForInitialization(timeoutSeconds: Double, answer: (Boolean) -> Unit) {
        val latch = synchronized(lock) { started }
        if (latch == null) {
            answer(false)
            return
        }
        waiters.execute {
            val deadline = System.nanoTime() + (timeoutSeconds * 1_000_000_000).toLong()
            latch.await(remainingNanos(deadline), TimeUnit.NANOSECONDS)
            while (true) {
                if (synchronized(lock) { client }?.isInitialized == true) return@execute answer(true)
                if (remainingNanos(deadline) <= 0) return@execute answer(false)
                Thread.sleep(POLL_MILLIS)
            }
        }
    }

    val isInitialized: Boolean get() = synchronized(lock) { client }?.isInitialized == true

    val context: String? get() = synchronized(lock) { contextJson }

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
            started = null
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

    private fun awaitStart(latch: CountDownLatch, options: StartOptions) {
        // The SDK's own wait ends the start; the margin only guards against a start that never returns.
        latch.await((options.startWaitWholeSeconds + START_MARGIN_SECONDS).toLong(), TimeUnit.SECONDS)
    }

    private fun remainingNanos(deadline: Long) = deadline - System.nanoTime()

    private const val POLL_MILLIS = 50L
    private const val START_MARGIN_SECONDS = 10
}
