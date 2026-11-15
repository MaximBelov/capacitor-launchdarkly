package io.github.maximbelov.launchdarkly

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginConfigTest {
    @Test
    fun noConfigBlockMeansNoNativeStart() {
        assertNull(PluginConfig.autoStart(null))
        assertNull(PluginConfig.autoStart(JSONObject()))
    }

    @Test
    fun aMissingBlankOrNonStringMobileKeyMeansNoNativeStart() {
        assertNull(PluginConfig.autoStart(JSONObject().put("streaming", false)))
        assertNull(PluginConfig.autoStart(JSONObject().put("mobileKey", "  ")))
        assertNull(PluginConfig.autoStart(JSONObject().put("mobileKey", 42)))
    }

    @Test
    fun aMobileKeyAloneStartsWithTheDefaults() {
        val start = PluginConfig.autoStart(JSONObject().put("mobileKey", "mob-test"))!!
        assertEquals(StartOptions(mobileKey = "mob-test"), start.options)
        assertTrue(start.options.streaming)
        assertFalse(start.options.evaluationReasons)
        assertFalse(start.options.offline)
        assertEquals(5.0, start.options.startWaitSeconds, 0.0)
        assertEquals(PluginConfig.DEFAULT_INITIAL_CONTEXT, start.initialContext)
    }

    @Test
    fun theDefaultInitialContextIsTheSharedAnonymousOne() {
        val context = Contexts.parse(PluginConfig.DEFAULT_INITIAL_CONTEXT)
        assertEquals("user", context.kind.toString())
        assertEquals("anonymous_user", context.key)
        assertTrue(context.isAnonymous)
    }

    @Test
    fun readsEveryOption() {
        val config = JSONObject()
            .put("mobileKey", "mob-test")
            .put("streaming", false)
            .put("evaluationReasons", true)
            .put("offline", true)
            .put("startWaitSeconds", 2.5)
            .put("application", JSONObject().put("id", "app").put("name", "App").put("version", "1.2.3").put("versionName", "1.2"))
            .put("initialContext", JSONObject().put("kind", "device").put("key", "shared").put("anonymous", true))
        val start = PluginConfig.autoStart(config)!!
        assertEquals(
            StartOptions("mob-test", false, true, true, 2.5, ApplicationMetadata("app", "App", "1.2.3", "1.2")),
            start.options,
        )
        assertEquals(3, start.options.startWaitWholeSeconds)
        assertEquals("shared", Contexts.parse(start.initialContext).key)
    }

    @Test
    fun aNegativeWaitFallsBackToTheDefault() {
        assertEquals(5.0, StartOptions.parse("k", JSONObject().put("startWaitSeconds", -1)).startWaitSeconds, 0.0)
    }
}
