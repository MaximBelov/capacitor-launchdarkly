import XCTest
@testable import LaunchDarklyPlugin

final class PluginConfigurationTests: XCTestCase {
    func testNoConfigBlockMeansNoNativeStart() {
        XCTAssertNil(PluginConfiguration.autoStart(nil))
        XCTAssertNil(PluginConfiguration.autoStart([:]))
    }

    func testAMissingBlankOrNonStringMobileKeyMeansNoNativeStart() {
        XCTAssertNil(PluginConfiguration.autoStart(["streaming": false]))
        XCTAssertNil(PluginConfiguration.autoStart(["mobileKey": "  "]))
        XCTAssertNil(PluginConfiguration.autoStart(["mobileKey": 42]))
    }

    func testAMobileKeyAloneStartsWithTheDefaults() throws {
        let start = try XCTUnwrap(PluginConfiguration.autoStart(["mobileKey": "mob-test"]))
        XCTAssertEqual(start.options, StartOptions(mobileKey: "mob-test"))
        XCTAssertTrue(start.options.streaming)
        XCTAssertFalse(start.options.evaluationReasons)
        XCTAssertFalse(start.options.offline)
        XCTAssertEqual(start.options.startWaitSeconds, 5)
        XCTAssertEqual(start.initialContext, PluginConfiguration.defaultInitialContext)
    }

    func testReadsEveryOption() throws {
        let start = try XCTUnwrap(PluginConfiguration.autoStart([
            "mobileKey": "mob-test",
            "streaming": false,
            "evaluationReasons": true,
            "offline": true,
            "startWaitSeconds": 2.5,
            "application": ["id": "app", "name": "App", "version": "1.2.3", "versionName": "1.2"],
            "initialContext": ["kind": "device", "key": "shared", "anonymous": true]
        ]))
        var expected = StartOptions(mobileKey: "mob-test")
        expected.streaming = false
        expected.evaluationReasons = true
        expected.offline = true
        expected.startWaitSeconds = 2.5
        expected.application = ApplicationMetadata(id: "app", name: "App", version: "1.2.3", versionName: "1.2")
        XCTAssertEqual(start.options, expected)
        XCTAssertEqual(try Contexts.parse(start.initialContext).contextKeys()["device"], "shared")
    }

    func testAWaitThatIsNotAUsableNumberFallsBackToTheDefault() {
        XCTAssertEqual(StartOptions.seconds(-1), 5)
        XCTAssertEqual(StartOptions.seconds(true), 5)
        XCTAssertEqual(StartOptions.seconds("3"), 5)
        XCTAssertEqual(StartOptions.seconds(3), 3)
    }
}
