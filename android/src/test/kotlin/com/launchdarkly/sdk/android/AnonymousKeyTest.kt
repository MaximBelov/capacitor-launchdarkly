package com.launchdarkly.sdk.android

import com.launchdarkly.logging.LDLogger
import com.launchdarkly.sdk.LDContext
import com.launchdarkly.sdk.android.subsystems.PersistentDataStore
import io.github.maximbelov.launchdarkly.Contexts
import io.github.maximbelov.launchdarkly.LdConfigFactory
import io.github.maximbelov.launchdarkly.PluginConfig
import io.github.maximbelov.launchdarkly.StartOptions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

// Runs the SDK's own context modifiers, the ones LDClient.init and LDClient.identify apply to every context, with the
// configuration the plugin builds. This test lives in the SDK's package because the modifiers are package-private there.
class AnonymousKeyTest {
    private val store = object : PersistentDataStore {
        private val data = HashMap<String, HashMap<String, String>>()
        override fun getValue(storeNamespace: String, key: String): String? = data[storeNamespace]?.get(key)
        override fun setValue(storeNamespace: String, key: String, value: String?) {
            val space = data.getOrPut(storeNamespace) { HashMap() }
            if (value == null) space.remove(key) else space[key] = value
        }
        override fun setValues(storeNamespace: String, keysAndValues: MutableMap<String, String?>) {
            keysAndValues.forEach { (k, v) -> setValue(storeNamespace, k, v) }
        }
        override fun getKeys(storeNamespace: String): Collection<String> = data[storeNamespace]?.keys ?: emptySet()
        override fun getAllNamespaces(): Collection<String> = data.keys
        override fun clear(storeNamespace: String, fullyDelete: Boolean) {
            data.remove(storeNamespace)
        }
    }

    private fun modify(context: LDContext, generateAnonymousKeys: Boolean): LDContext =
        AnonymousKeyContextModifier(PersistentDataStoreWrapper(store, LDLogger.none()), generateAnonymousKeys).modifyContext(context)

    @Test
    fun theSdkKeepsTheKeyOfAnAnonymousContextUnderThePluginsConfig() {
        val config = LdConfigFactory.build(StartOptions("mob-test"))
        val context = Contexts.parse(PluginConfig.DEFAULT_INITIAL_CONTEXT)
        assertEquals("anonymous_user", modify(context, config.isGenerateAnonymousKeys).key)
    }

    @Test
    fun theSdkKeepsTheKeyOfAnAnonymousKindInAMultiContext() {
        val config = LdConfigFactory.build(StartOptions("mob-test"))
        val context = Contexts.parse("""{"kind":"multi","user":{"key":"anonymous_user","anonymous":true},"org":{"key":"o1"}}""")
        assertEquals("anonymous_user", modify(context, config.isGenerateAnonymousKeys).getIndividualContext("user").key)
    }

    // The control: the same modifier with generation on replaces the key, so the test above would see it if the plugin's
    // configuration ever turned generation on.
    @Test
    fun withGenerationOnTheSdkWouldReplaceTheKey() {
        val context = Contexts.parse(PluginConfig.DEFAULT_INITIAL_CONTEXT)
        assertNotEquals("anonymous_user", modify(context, true).key)
    }

    @Test
    fun theAutoEnvModifierIsNotTheOneTheSdkUsesUnderThePluginsConfig() {
        // LDClient.init picks AutoEnvContextModifier only when isAutoEnvAttributes() is true; otherwise NoOpContextModifier.
        val config = LdConfigFactory.build(StartOptions("mob-test"))
        val context = Contexts.parse(PluginConfig.DEFAULT_INITIAL_CONTEXT)
        assertEquals(false, config.isAutoEnvAttributes)
        assertEquals(context, NoOpContextModifier().modifyContext(context))
    }
}
