import XCTest
import LaunchDarkly
@testable import LaunchDarklyPlugin

final class JSONValuesTests: XCTestCase {
    func testReadsNameCustomAttributesNestedObjectsAndPrivateAttributes() throws {
        let context = try Contexts.parse("""
        {"kind":"user","key":"u1","name":"Ann","plan":"pro","seats":3,"beta":true,"tags":["a","b"],
         "address":{"country":"IE","city":"Cork"},"_meta":{"privateAttributes":["email","/address/city"]}}
        """)
        XCTAssertEqual(context.getValue(Reference("name")), .string("Ann"))
        XCTAssertEqual(context.getValue(Reference("plan")), .string("pro"))
        XCTAssertEqual(context.getValue(Reference("seats")), .number(3))
        XCTAssertEqual(context.getValue(Reference("beta")), .bool(true))
        XCTAssertEqual(context.getValue(Reference("tags")), .array([.string("a"), .string("b")]))
        XCTAssertEqual(context.getValue(Reference("/address/city")), .string("Cork"))
        XCTAssertEqual(context.getValue(Reference("anonymous")), .bool(false))
        // The SDK encodes a context for events with its private attributes redacted: the private city is gone, the rest stays.
        let encoded = try XCTUnwrap(String(data: try JSONEncoder().encode(context), encoding: .utf8))
        XCTAssertTrue(encoded.contains("redactedAttributes"), encoded)
        XCTAssertFalse(encoded.contains("Cork"), encoded)
        XCTAssertTrue(encoded.contains("IE"), encoded)
    }

    func testReadsAMultiContext() throws {
        let context = try Contexts.parse(#"{"kind":"multi","user":{"key":"u1"},"org":{"key":"o1","name":"Farm"}}"#)
        XCTAssertTrue(context.isMulti())
        XCTAssertEqual(context.contextKeys(), ["user": "u1", "org": "o1"])
    }

    func testAnInvalidKindIsRejected() {
        XCTAssertThrowsError(try Contexts.parse(#"{"kind":"kind","key":"k"}"#))
    }

    func testTheJSONOfADictionaryRoundTrips() throws {
        let json = try Contexts.json(from: ["kind": "user", "key": "u1", "anonymous": true, "seats": 3])
        let context = try Contexts.parse(json)
        XCTAssertEqual(context.getValue(Reference("anonymous")), .bool(true))
        XCTAssertEqual(context.getValue(Reference("seats")), .number(3))
    }

    func testValuesOfEveryJSONTypeGoBothWays() {
        XCTAssertEqual(JSValues.toLDValue(true), .bool(true))
        XCTAssertEqual(JSValues.toLDValue(3), .number(3))
        XCTAssertEqual(JSValues.toLDValue(2.5), .number(2.5))
        XCTAssertEqual(JSValues.toLDValue("text"), .string("text"))
        XCTAssertEqual(JSValues.toLDValue(["a": 1]), .object(["a": .number(1)]))
        XCTAssertEqual(JSValues.toLDValue([1, "two"]), .array([.number(1), .string("two")]))
        XCTAssertEqual(JSValues.toJS(.bool(true)) as? Bool, true)
        XCTAssertEqual(JSValues.toJS(.string("text")) as? String, "text")
        XCTAssertEqual((JSValues.toJS(.object(["a": .number(1)])) as? [String: Any])?["a"] as? Int, 1)
    }

    func testABooleanStaysABoolean() {
        // NSNumber carries both; a true that became 1 would compare unequal to true in JavaScript.
        XCTAssertEqual(JSValues.toLDValue(NSNumber(value: true)), .bool(true))
        let data = try? JSONSerialization.data(withJSONObject: ["v": JSValues.toJS(.bool(false))])
        XCTAssertEqual(data.flatMap { String(data: $0, encoding: .utf8) }, #"{"v":false}"#)
    }

    func testNullAndAbsentAreJSONNull() {
        XCTAssertEqual(JSValues.toLDValue(nil), .null)
        XCTAssertEqual(JSValues.toLDValue(NSNull()), .null)
        XCTAssertTrue(JSValues.toJS(.null) is NSNull)
        XCTAssertTrue(JSValues.toJS(nil) is NSNull)
    }
}
