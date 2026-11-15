package io.github.maximbelov.launchdarkly

import com.launchdarkly.sdk.AttributeRef
import com.launchdarkly.sdk.ContextKind
import com.launchdarkly.sdk.LDValue
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class JsonTest {
    @Test
    fun anAnonymousContextKeepsItsKey() {
        val context = Contexts.parse("""{"kind":"user","key":"anonymous_user","anonymous":true}""")
        assertTrue(context.isAnonymous)
        assertEquals("anonymous_user", context.key)
    }

    @Test
    fun readsNameCustomAttributesNestedObjectsAndPrivateAttributes() {
        val context = Contexts.parse(
            """{"kind":"user","key":"u1","name":"Ann","plan":"pro","seats":3,"beta":true,"tags":["a","b"],
               "address":{"country":"IE","city":"Cork"},"_meta":{"privateAttributes":["email","/address/city"]}}""",
        )
        assertEquals("Ann", context.name)
        assertFalse(context.isAnonymous)
        assertEquals(LDValue.of("pro"), context.getValue("plan"))
        assertEquals(LDValue.of(3), context.getValue("seats"))
        assertEquals(LDValue.of(true), context.getValue("beta"))
        assertEquals(LDValue.parse("""["a","b"]"""), context.getValue("tags"))
        assertEquals(LDValue.of("Cork"), context.getValue(AttributeRef.fromPath("/address/city")))
        assertEquals(2, context.privateAttributeCount)
        assertEquals(AttributeRef.fromPath("/address/city"), context.getPrivateAttribute(1))
    }

    @Test
    fun readsAMultiContext() {
        val context = Contexts.parse(
            """{"kind":"multi","user":{"key":"anonymous_user","anonymous":true},"org":{"key":"o1","name":"Farm"}}""",
        )
        assertTrue(context.isMultiple)
        assertEquals("anonymous_user", context.getIndividualContext(ContextKind.of("user")).key)
        assertTrue(context.getIndividualContext(ContextKind.of("user")).isAnonymous)
        assertEquals("Farm", context.getIndividualContext("org").name)
    }

    @Test(expected = IllegalArgumentException::class)
    fun aContextWithoutAKeyIsRejected() {
        Contexts.parse("""{"kind":"user","anonymous":true}""")
    }

    @Test(expected = IllegalArgumentException::class)
    fun anInvalidKindIsRejected() {
        Contexts.parse("""{"kind":"kind","key":"k"}""")
    }

    @Test
    fun valuesOfEveryJsonTypeGoBothWays() {
        val object_ = JSONObject().put("a", 1).put("b", JSONArray().put("x").put(false))
        val cases = listOf<Any>(true, 3, 2.5, "text", object_, JSONArray().put(1).put("two"))
        for (value in cases) {
            val back = JsValues.toJs(JsValues.toLDValue(value))
            assertEquals(JsValues.jsonText(value), JsValues.jsonText(back))
        }
    }

    @Test
    fun theJsonTextOfAValueIsTheValueAlone() {
        assertEquals("true", JsValues.jsonText(true))
        assertEquals("\"a\\\"b\"", JsValues.jsonText("a\"b"))
        assertEquals("{\"n\":1}", JsValues.jsonText(JSONObject().put("n", 1)))
        assertEquals("null", JsValues.jsonText(null))
    }

    @Test
    fun nullAndAbsentAreJsonNull() {
        assertTrue(JsValues.toLDValue(null).isNull)
        assertTrue(JsValues.toLDValue(JSONObject.NULL).isNull)
        assertEquals(JSONObject.NULL, JsValues.toJs(LDValue.ofNull()))
        assertEquals(JSONObject.NULL, JsValues.toJs(null))
    }

    @Test
    fun flagsBecomeOneObject() {
        val flags = JsValues.flags(mapOf("on" to LDValue.of(true), "cfg" to LDValue.parse("""{"n":1}""")))
        assertEquals(true, flags.get("on"))
        assertEquals(1, flags.getJSONObject("cfg").getInt("n"))
    }
}
