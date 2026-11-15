package io.github.maximbelov.launchdarkly

import org.json.JSONObject

/** Application metadata sent with every request. It describes the app; it is not a context. */
data class ApplicationMetadata(
    val id: String? = null,
    val name: String? = null,
    val version: String? = null,
    val versionName: String? = null,
)

/** How the client is started: from `plugins.LaunchDarkly` in capacitor.config, or from `initialize()`. */
data class StartOptions(
    val mobileKey: String,
    val streaming: Boolean = true,
    val evaluationReasons: Boolean = false,
    val offline: Boolean = false,
    /** The default timeout of `waitForInitialization()`. Nothing else waits: the client starts without waiting. */
    val startWaitSeconds: Double = DEFAULT_WAIT_SECONDS,
    val application: ApplicationMetadata? = null,
) {
    companion object {
        const val DEFAULT_WAIT_SECONDS = 5.0

        /** The options of `initialize()` or of the config block, everything but the key and the context. */
        fun parse(mobileKey: String, json: JSONObject?): StartOptions {
            val options = json ?: JSONObject()
            return StartOptions(
                mobileKey = mobileKey,
                streaming = options.optBoolean("streaming", true),
                evaluationReasons = options.optBoolean("evaluationReasons", false),
                offline = options.optBoolean("offline", false),
                startWaitSeconds = seconds(options.optDouble("startWaitSeconds", DEFAULT_WAIT_SECONDS)),
                application = options.optJSONObject("application")?.let(::parseApplication),
            )
        }

        /** A wait in seconds as given, or the default when it is not a usable number. */
        fun seconds(value: Double, default: Double = DEFAULT_WAIT_SECONDS): Double =
            if (value.isNaN() || value.isInfinite() || value < 0) default else value

        private fun parseApplication(json: JSONObject) = ApplicationMetadata(
            id = json.optStringOrNull("id"),
            name = json.optStringOrNull("name"),
            version = json.optStringOrNull("version"),
            versionName = json.optStringOrNull("versionName"),
        )
    }
}

/** What the native start-up does when the app launches: start with [options] and [initialContext] unless a context was stored. */
data class AutoStart(val options: StartOptions, val initialContext: String)

object PluginConfig {
    /** The context of a native start-up that has neither a stored context nor an `initialContext`. */
    const val DEFAULT_INITIAL_CONTEXT = """{"kind":"user","key":"anonymous_user","anonymous":true}"""

    /**
     * Reads the `plugins.LaunchDarkly` block of capacitor.config. Without a `mobileKey` there is no native start-up, and the
     * answer is null: the app starts the client with `initialize()` instead.
     */
    fun autoStart(config: JSONObject?): AutoStart? {
        if (config == null) return null
        val mobileKey = config.optStringOrNull("mobileKey") ?: return null
        val initialContext = config.optJSONObject("initialContext")?.toString() ?: DEFAULT_INITIAL_CONTEXT
        return AutoStart(StartOptions.parse(mobileKey, config), initialContext)
    }
}

/** A string value, or null when it is absent, not a string, or blank. */
internal fun JSONObject.optStringOrNull(name: String): String? =
    (opt(name) as? String)?.takeIf { it.isNotBlank() }
