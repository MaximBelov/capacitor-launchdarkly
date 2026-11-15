package io.github.maximbelov.launchdarkly

import com.launchdarkly.sdk.LDValue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CompletableFuture

// Offline first: the state is read from the SDK's store as it is, and never waits for LaunchDarkly.
class ClientStateTest {
    private class FakeReader(
        private val flags: Map<String, LDValue>,
        private val lastSuccess: Long?,
    ) : FlagReader {
        override fun allFlags() = flags
        override fun lastSuccessfulConnection() = lastSuccess
    }

    private val cached = mapOf("on" to LDValue.of(true), "theme" to LDValue.of("green"))
    private val startedAt = 1_000_000L

    @Test
    fun withoutAClientThereIsNothing() {
        assertEquals(ClientState(false, FlagSource.NONE, emptyMap(), null), StateReader.read(null, startedAt, null))
    }

    @Test
    fun offlineTheCachedFlagsAreAnsweredAtOnceAsNotInitialised() {
        val began = System.nanoTime()
        val state = StateReader.read(FakeReader(cached, lastSuccess = null), startedAt, """{"kind":"user","key":"u1"}""")
        val elapsedMillis = (System.nanoTime() - began) / 1_000_000
        assertFalse(state.initialized)
        assertEquals(FlagSource.CACHE, state.source)
        assertEquals(cached, state.flags)
        assertTrue("took $elapsedMillis ms", elapsedMillis < 100)
    }

    @Test
    fun aConnectionFromAnEarlierRunDoesNotCountAsAnAnswerInThisOne() {
        // The SDK persists the time of its last successful connection, so one from before this start is not an answer.
        val state = StateReader.read(FakeReader(cached, lastSuccess = startedAt - 1), startedAt, null)
        assertFalse(state.initialized)
        assertEquals(FlagSource.CACHE, state.source)
    }

    @Test
    fun anAnswerInThisRunIsTheNetwork() {
        val state = StateReader.read(FakeReader(cached, lastSuccess = startedAt + 5), startedAt, null)
        assertTrue(state.initialized)
        assertEquals(FlagSource.NETWORK, state.source)
    }

    @Test
    fun noAnswerAndNoCacheIsNone() {
        val state = StateReader.read(FakeReader(emptyMap(), lastSuccess = null), startedAt, null)
        assertEquals(ClientState(false, FlagSource.NONE, emptyMap(), null), state)
    }

    @Test
    fun theStateReachesJavaScriptWithItsSource() {
        val js = LaunchDarklyPlugin.toJs(ClientState(false, FlagSource.CACHE, cached, """{"kind":"user","key":"u1"}"""))
        assertEquals(false, js.getBoolean("initialized"))
        assertEquals("cache", js.getString("source"))
        assertEquals("green", js.getJSONObject("flags").getString("theme"))
        assertEquals("u1", js.getJSONObject("context").getString("key"))
    }

    @Test
    fun anIdentifyThatNeverCompletesResolvesAsTimedOutAfterItsTimeout() {
        val began = System.nanoTime()
        val timedOut = IdentifyWait.timedOut(CompletableFuture<Void>(), 100, startedAt, FakeReader(cached, null))
        val elapsedMillis = (System.nanoTime() - began) / 1_000_000
        assertTrue(timedOut)
        assertTrue("took $elapsedMillis ms", elapsedMillis in 90..1000)
    }

    @Test
    fun anIdentifyTheSdkCompletesOfflineIsTimedOut() {
        // Offline the SDK completes identify at once, without asking the network: the flags are the cached ones.
        val done = CompletableFuture.completedFuture<Void>(null)
        assertTrue(IdentifyWait.timedOut(done, 1000, startedAt, FakeReader(cached, lastSuccess = null)))
    }

    @Test
    fun aFailedIdentifyIsTimedOutRatherThanAnError() {
        val failed = CompletableFuture<Void>().apply { completeExceptionally(java.io.IOException("network down")) }
        assertTrue(IdentifyWait.timedOut(failed, 1000, startedAt, FakeReader(cached, null)))
    }

    @Test
    fun anIdentifyAnsweredByLaunchDarklyIsNotTimedOut() {
        val done = CompletableFuture.completedFuture<Void>(null)
        assertFalse(IdentifyWait.timedOut(done, 1000, startedAt, FakeReader(cached, lastSuccess = startedAt + 10)))
    }
}
