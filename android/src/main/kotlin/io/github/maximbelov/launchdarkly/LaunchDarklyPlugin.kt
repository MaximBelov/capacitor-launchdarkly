package io.github.maximbelov.launchdarkly

import android.app.Application
import android.content.Context
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.launchdarkly.sdk.LDValue
import org.json.JSONObject

@CapacitorPlugin(name = "LaunchDarkly")
class LaunchDarklyPlugin : Plugin(), ClientEvents {

    private val store by lazy {
        SharedPreferencesContextStore(
            context.getSharedPreferences(SharedPreferencesContextStore.PREFERENCES, Context.MODE_PRIVATE),
        )
    }

    private val application: Application get() = context.applicationContext as Application

    /**
     * Runs as the bridge is created, before the web view loads the app. With a `mobileKey` in `plugins.LaunchDarkly` of
     * capacitor.config the client starts here, with the stored context or else `initialContext`, so the flags are on their way
     * before any app code asks for them. Without one nothing starts, and `initialize()` does it.
     */
    override fun load() {
        LaunchDarklyClient.events = this
        val autoStart = PluginConfig.autoStart(config.configJSON) ?: return
        val context = StartContext.choose(store.read(), autoStart.initialContext)
        LaunchDarklyClient.start(application, autoStart.options, context)
    }

    @PluginMethod
    fun initialize(call: PluginCall) {
        val mobileKey = call.getString("mobileKey")?.takeIf { it.isNotBlank() }
            ?: return call.reject("initialize needs a mobileKey on Android.")
        if (LaunchDarklyClient.mobileKey == mobileKey) {
            // One client per process: the same key changes nothing and answers the state once the start is done.
            return LaunchDarklyClient.afterStart { call.resolve(state()) }
        }
        val given = readContext(call) ?: return
        val options = StartOptions.parse(mobileKey, call.getObject("options"))
        // The given context plays the part of initialContext: a context an earlier identify() stored wins over it.
        val context = StartContext.choose(store.read(), given.json)
        LaunchDarklyClient.start(application, options, context) { call.resolve(state()) }
    }

    @PluginMethod
    fun waitForInitialization(call: PluginCall) {
        val timeout = StartOptions.seconds(call.getDouble("timeoutSeconds") ?: StartOptions.DEFAULT_WAIT_SECONDS)
        LaunchDarklyClient.waitForInitialization(timeout) { initialized ->
            call.resolve(JSObject().put("initialized", initialized))
        }
    }

    @PluginMethod
    fun getState(call: PluginCall) {
        LaunchDarklyClient.afterStart { call.resolve(state()) }
    }

    @PluginMethod
    fun identify(call: PluginCall) {
        val context = readContext(call) ?: return
        val timeout = StartOptions.seconds(call.getDouble("timeoutSeconds") ?: StartOptions.DEFAULT_WAIT_SECONDS)
        LaunchDarklyClient.identify(context, timeout, store) { timedOut, error ->
            if (error != null) call.reject(error.message ?: "identify failed", error) else call.resolve(JSObject().put("timedOut", timedOut == true))
        }
    }

    @PluginMethod
    fun variation(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("variation needs a key.")
        val defaultValue = JsValues.toLDValue(call.data.opt("defaultValue"))
        val value = LaunchDarklyClient.variation(key, defaultValue)
        call.resolve(JSObject().put("value", JsValues.toJs(value)))
    }

    @PluginMethod
    fun allFlags(call: PluginCall) {
        call.resolve(JSObject().put("flags", JsValues.flags(LaunchDarklyClient.allFlags())))
    }

    @PluginMethod
    fun setStreaming(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: return call.reject("setStreaming needs enabled.")
        LaunchDarklyClient.restart(application, { it.copy(streaming = enabled) }) { error ->
            if (error != null) call.reject(error.message, error) else call.resolve()
        }
    }

    @PluginMethod
    fun setOnline(call: PluginCall) {
        val online = call.getBoolean("online") ?: return call.reject("setOnline needs online.")
        LaunchDarklyClient.setOnline(online)
        call.resolve()
    }

    @PluginMethod
    fun flush(call: PluginCall) {
        LaunchDarklyClient.flush()
        call.resolve()
    }

    @PluginMethod
    fun close(call: PluginCall) {
        LaunchDarklyClient.close { call.resolve() }
    }

    @PluginMethod
    fun clearStoredContext(call: PluginCall) {
        store.clear()
        call.resolve()
    }

    override fun flagChanged(key: String, value: LDValue?, previous: LDValue?) {
        val change = JSObject().put("key", key).put("value", JsValues.toJs(value))
        if (previous != null) change.put("previous", JsValues.toJs(previous))
        notifyListeners("flagChange", change)
    }

    override fun connectionModeChanged(mode: String) {
        notifyListeners("connectionModeChange", JSObject().put("mode", mode))
    }

    private fun readContext(call: PluginCall): ContextChoice? {
        val json = call.getObject("context")?.toString() ?: run {
            call.reject("A context is needed.")
            return null
        }
        return try {
            ContextChoice(Contexts.parse(json), json)
        } catch (e: IllegalArgumentException) {
            call.reject(e.message, e)
            null
        }
    }

    private fun state(): JSObject {
        val state = JSObject()
            .put("initialized", LaunchDarklyClient.isInitialized)
            .put("flags", JsValues.flags(LaunchDarklyClient.allFlags()))
        LaunchDarklyClient.context?.let { state.put("context", JSONObject(it)) }
        return state
    }
}
