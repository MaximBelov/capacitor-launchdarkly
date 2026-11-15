import XCTest
import LaunchDarkly
@testable import LaunchDarklyPlugin

// LaunchDarkly bills client-side SDKs by unique context keys. The plugin keeps the count at the keys the app passes: no
// automatic environment contexts (ld_application, ld_device), and no key generated for an anonymous context.
final class BillingSafetyTests: XCTestCase {
    func testAutomaticEnvironmentAttributesAreDisabled() {
        XCTAssertFalse(ConfigFactory.make(StartOptions(mobileKey: "mob-test")).autoEnvAttributes)
    }

    func testTheNativeStartPathBuildsTheSameSafeConfig() throws {
        let start = try XCTUnwrap(PluginConfiguration.autoStart(["mobileKey": "mob-test"]))
        XCTAssertFalse(ConfigFactory.make(start.options).autoEnvAttributes)
    }

    func testTheNativeStartPathBeginsWithTheSharedAnonymousKey() throws {
        let start = try XCTUnwrap(PluginConfiguration.autoStart(["mobileKey": "mob-test"]))
        let context = StartContext.choose(stored: nil, initialContext: start.initialContext).context
        XCTAssertEqual(context.contextKeys(), ["user": "anonymous_user"])
        XCTAssertEqual(context.getValue(Reference("anonymous")), .bool(true))
    }

    func testAnAnonymousContextKeepsItsKey() throws {
        let context = try Contexts.parse(#"{"kind":"user","key":"anonymous_user","anonymous":true}"#)
        XCTAssertEqual(context.fullyQualifiedKey(), "anonymous_user")
        XCTAssertEqual(context.getValue(Reference("anonymous")), .bool(true))
    }

    func testAnAnonymousKindInAMultiContextKeepsItsKey() throws {
        let context = try Contexts.parse(#"{"kind":"multi","user":{"key":"anonymous_user","anonymous":true},"org":{"key":"o1"}}"#)
        XCTAssertEqual(context.contextKeys(), ["user": "anonymous_user", "org": "o1"])
    }

    func testAContextWithoutAKeyIsRejectedRatherThanGivenOne() {
        XCTAssertThrowsError(try Contexts.parse(#"{"kind":"user","anonymous":true}"#))
    }

    func testOptionsArePassedOn() {
        var options = StartOptions(mobileKey: "mob-test")
        options.streaming = false
        options.evaluationReasons = true
        options.offline = true
        options.application = ApplicationMetadata(id: "app")
        let config = ConfigFactory.make(options)
        XCTAssertEqual(config.mobileKey, "mob-test")
        XCTAssertEqual(config.streamingMode, .polling)
        XCTAssertTrue(config.evaluationReasons)
        XCTAssertFalse(config.startOnline)
        XCTAssertNotNil(config.applicationInfo)
        XCTAssertFalse(config.autoEnvAttributes)
    }
}
