package io.github.maximbelov.launchdarkly

import com.getcapacitor.JSObject
import com.launchdarkly.sdk.LDContext
import com.launchdarkly.sdk.LDValue
import com.launchdarkly.sdk.json.JsonSerialization
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * Contexts in the JSON shape LaunchDarkly's SDKs use, read by the SDK's own parser, so custom attributes of any JSON type,
 * nested objects, `anonymous`, `name`, multi-contexts and `_meta.privateAttributes` mean what they mean to LaunchDarkly. The key
 * is taken as given: nothing here generates or replaces one.
 */
object Contexts {
    /** The context [json] describes. Throws [IllegalArgumentException] for one the SDK does not accept. */
    fun parse(json: String): LDContext {
        val context = try {
            JsonSerialization.deserialize(json, LDContext::class.java)
        } catch (e: Exception) {
            throw IllegalArgumentException("Invalid context: ${e.message}", e)
        }
        require(context != null && context.isValid) { "Invalid context: ${context?.error ?: "empty"}" }
        return context
    }

    /** [parse], or null for a context that is absent or not valid. */
    fun parseOrNull(json: String?): LDContext? = json?.let {
        try {
            parse(it)
        } catch (e: IllegalArgumentException) {
            null
        }
    }
}

/** Flag values between JavaScript (org.json values, as Capacitor hands them over) and the SDK's [LDValue], through JSON text. */
object JsValues {
    /** An org.json value (JSONObject, JSONArray, String, Number, Boolean, JSONObject.NULL or null) as an [LDValue]. */
    fun toLDValue(value: Any?): LDValue {
        if (value == null || value == JSONObject.NULL) return LDValue.ofNull()
        return LDValue.parse(jsonText(value))
    }

    /**
     * The JSON text of one org.json value. Android's org.json has no `valueToString`, so the value is written as the only item
     * of an array and the brackets are dropped.
     */
    fun jsonText(value: Any?): String {
        val array = JSONArray().put(value ?: JSONObject.NULL).toString()
        return array.substring(1, array.length - 1)
    }

    /** An [LDValue] as the org.json value Capacitor sends to JavaScript; JSON null is [JSONObject.NULL]. */
    fun toJs(value: LDValue?): Any {
        if (value == null || value.isNull) return JSONObject.NULL
        return JSONTokener(value.toJsonString()).nextValue()
    }

    /** Every flag as one JavaScript object. */
    fun flags(values: Map<String, LDValue>): JSObject {
        val flags = JSObject()
        for ((key, value) in values) flags.put(key, toJs(value))
        return flags
    }
}
