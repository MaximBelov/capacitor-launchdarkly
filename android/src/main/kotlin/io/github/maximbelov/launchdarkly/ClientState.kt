package io.github.maximbelov.launchdarkly

import com.launchdarkly.sdk.LDValue
import java.util.concurrent.ExecutionException
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** Where the flags `getState()` answers came from. */
enum class FlagSource(val js: String) {
    /** LaunchDarkly answered in this process. */
    NETWORK("network"),

    /** Not yet: the values the SDK cached on the device for this context on an earlier run. */
    CACHE("cache"),

    /** Neither: no answer yet and nothing cached. */
    NONE("none"),
}

/** What `getState()` answers, read from the SDK without waiting for anything. */
data class ClientState(
    val initialized: Boolean,
    val source: FlagSource,
    val flags: Map<String, LDValue>,
    val context: String?,
)

/** The few reads the state needs, so that it can be built from a fake on the JVM. */
interface FlagReader {
    /** Every flag in the SDK's store: the cached values right after `init`, fresh ones once LaunchDarkly answered. */
    fun allFlags(): Map<String, LDValue>

    /**
     * When a data source last connected successfully, in epoch milliseconds, or null. The SDK sets it only for a connection
     * that is actually active (`ConnectivityManager.updateConnectionInfoForSuccess`), never for OFFLINE or SET_OFFLINE, and
     * persists it, so it is compared with the time this process started the client.
     */
    fun lastSuccessfulConnection(): Long?
}

object StateReader {
    /** Whether LaunchDarkly answered after [sinceMillis]. */
    fun answeredSince(reader: FlagReader, sinceMillis: Long): Boolean {
        val last = reader.lastSuccessfulConnection() ?: return false
        return last >= sinceMillis
    }

    /**
     * The state as it is now. Never blocks: offline, before LaunchDarkly answered, it answers the flags the SDK loaded from
     * its cache at `init`, with `initialized` false and source CACHE (or NONE when nothing was cached).
     */
    fun read(reader: FlagReader?, startedAtMillis: Long, context: String?): ClientState {
        if (reader == null) return ClientState(false, FlagSource.NONE, emptyMap(), null)
        val flags = reader.allFlags()
        val initialized = answeredSince(reader, startedAtMillis)
        val source = when {
            initialized -> FlagSource.NETWORK
            flags.isNotEmpty() -> FlagSource.CACHE
            else -> FlagSource.NONE
        }
        return ClientState(initialized, source, flags, context)
    }
}

object IdentifyWait {
    /**
     * Waits at most [timeoutMillis] for an `identify` future and answers whether the flags of the new context did NOT arrive
     * from LaunchDarkly in time. Never throws for the network: a future that fails, never completes, or completes without a
     * fresh connection (the SDK completes it at once when the device is offline) all answer true.
     */
    fun timedOut(future: Future<*>, timeoutMillis: Long, startedAtMillis: Long, reader: FlagReader): Boolean {
        try {
            future.get(timeoutMillis, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            return true
        } catch (e: ExecutionException) {
            return true
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            return true
        }
        return !StateReader.answeredSince(reader, startedAtMillis)
    }
}
