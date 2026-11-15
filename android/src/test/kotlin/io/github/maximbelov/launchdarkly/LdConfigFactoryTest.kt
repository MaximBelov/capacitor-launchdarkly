package io.github.maximbelov.launchdarkly

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// LaunchDarkly bills client-side SDKs by unique context keys. These two settings keep the count at the keys the app passes.
class LdConfigFactoryTest {
    @Test
    fun automaticEnvironmentAttributesAreDisabled() {
        assertFalse(LdConfigFactory.build(StartOptions("mob-test")).isAutoEnvAttributes)
    }

    @Test
    fun anonymousKeysAreNotGenerated() {
        assertFalse(LdConfigFactory.build(StartOptions("mob-test")).isGenerateAnonymousKeys)
    }

    @Test
    fun theNativeStartPathBuildsTheSameSafeConfig() {
        val config = LdConfigFactory.build(PluginConfig.autoStart(org.json.JSONObject().put("mobileKey", "mob-test"))!!.options)
        assertFalse(config.isAutoEnvAttributes)
        assertFalse(config.isGenerateAnonymousKeys)
    }

    @Test
    fun passesTheOptionsOn() {
        val config = LdConfigFactory.build(
            StartOptions("mob-test", streaming = false, evaluationReasons = true, offline = true, application = ApplicationMetadata(id = "app")),
        )
        assertEquals("mob-test", config.mobileKey)
        assertTrue(config.isEvaluationReasons)
        assertTrue(config.isOffline)
        assertFalse(config.isAutoEnvAttributes)
        assertFalse(config.isGenerateAnonymousKeys)
    }
}
