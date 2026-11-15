package io.github.maximbelov.launchdarkly

import android.content.SharedPreferences
import com.launchdarkly.sdk.LDContext

/** Where the context of the last `identify()` is kept between launches. */
interface ContextStore {
    fun read(): String?
    fun write(json: String)
    fun clear()
}

/** [ContextStore] in the plugin's own preferences file, [PREFERENCES], private to the app. */
class SharedPreferencesContextStore(private val preferences: SharedPreferences) : ContextStore {
    override fun read(): String? = preferences.getString(KEY, null)

    override fun write(json: String) {
        preferences.edit().putString(KEY, json).apply()
    }

    override fun clear() {
        preferences.edit().remove(KEY).apply()
    }

    companion object {
        const val PREFERENCES = "CapacitorLaunchDarkly"
        const val KEY = "context"
    }
}

/** A context and the JSON it was read from, which is what the plugin stores and answers in `getState()`. */
data class ContextChoice(val context: LDContext, val json: String)

object StartContext {
    /**
     * The context a native start-up begins with: the stored one when there is a valid one, so the app does not flip to the
     * initial (usually anonymous) context for a moment and the SDK uses its flag cache for that context; else [initialContext];
     * else the default anonymous context.
     */
    fun choose(stored: String?, initialContext: String): ContextChoice {
        for (json in listOf(stored, initialContext, PluginConfig.DEFAULT_INITIAL_CONTEXT)) {
            val context = Contexts.parseOrNull(json) ?: continue
            return ContextChoice(context, json!!)
        }
        throw IllegalStateException("the default context is not valid")
    }
}
