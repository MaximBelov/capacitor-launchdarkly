package io.github.maximbelov.launchdarkly

import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

// The JavaScript reaches the plugin by the name in @CapacitorPlugin and the method by its name; a rename on either side fails only
// at run time on a phone, so it is pinned here.
class LaunchDarklyPluginTest {
    private val methods = listOf(
        "allFlags", "clearStoredContext", "close", "flush", "getState", "identify", "initialize", "setOnline", "setStreaming",
        "variation", "waitForInitialization",
    )

    @Test
    fun isRegisteredUnderTheNameTheJavaScriptUsesAndTheConfigBlockIsNamedFor() {
        val annotation = LaunchDarklyPlugin::class.java.getAnnotation(CapacitorPlugin::class.java)
        assertNotNull(annotation)
        assertEquals("LaunchDarkly", annotation!!.name)
    }

    @Test
    fun exposesEveryMethodAsAPluginMethodAndNothingElse() {
        for (name in methods) {
            val method = LaunchDarklyPlugin::class.java.getMethod(name, PluginCall::class.java)
            assertNotNull(name, method.getAnnotation(PluginMethod::class.java))
        }
        val annotated = LaunchDarklyPlugin::class.java.declaredMethods
            .filter { it.isAnnotationPresent(PluginMethod::class.java) }
            .map { it.name }
            .sorted()
        assertEquals(methods, annotated)
    }
}
