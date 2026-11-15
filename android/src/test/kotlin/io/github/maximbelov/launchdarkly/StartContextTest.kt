package io.github.maximbelov.launchdarkly

import org.junit.Assert.assertEquals
import org.junit.Test

class StartContextTest {
    private val initial = """{"kind":"user","key":"anonymous_user","anonymous":true}"""
    private val stored = """{"kind":"user","key":"user-42","name":"Ann"}"""

    @Test
    fun aStoredContextWinsOverTheInitialOne() {
        val choice = StartContext.choose(stored, initial)
        assertEquals("user-42", choice.context.key)
        assertEquals(stored, choice.json)
    }

    @Test
    fun withoutAStoredContextTheInitialOneIsUsed() {
        assertEquals("anonymous_user", StartContext.choose(null, initial).context.key)
    }

    @Test
    fun anInvalidStoredContextFallsBackToTheInitialOne() {
        assertEquals("anonymous_user", StartContext.choose("""{"kind":"user"}""", initial).context.key)
        assertEquals("anonymous_user", StartContext.choose("not json", initial).context.key)
    }

    @Test
    fun anInvalidInitialContextFallsBackToTheDefault() {
        val choice = StartContext.choose(null, """{"kind":"multi"}""")
        assertEquals(PluginConfig.DEFAULT_INITIAL_CONTEXT, choice.json)
    }
}
