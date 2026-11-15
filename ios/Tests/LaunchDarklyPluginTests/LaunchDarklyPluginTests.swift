import XCTest
import Capacitor
@testable import LaunchDarklyPlugin

// The JavaScript reaches the plugin by jsName and the method by its name; a rename on either side fails only at run time on a
// phone, so it is pinned here. jsName is also the name of the config block, plugins.LaunchDarkly.
final class LaunchDarklyPluginTests: XCTestCase {
    private let methods = [
        "initialize", "waitForInitialization", "getState", "identify", "variation", "allFlags", "setStreaming", "setOnline",
        "flush", "close", "clearStoredContext"
    ]

    func testIsRegisteredUnderTheNameTheJavaScriptUses() {
        XCTAssertEqual(LaunchDarklyPlugin().jsName, "LaunchDarkly")
    }

    func testExposesEveryMethodAsAPromiseMethodAndNothingElse() {
        let registered = LaunchDarklyPlugin().pluginMethods
        XCTAssertEqual(registered.map { $0.name }, methods)
        XCTAssertTrue(registered.allSatisfy { $0.returnType == CAPPluginReturnPromise })
    }

    func testEveryMethodNameHasAnObjectiveCSelector() {
        // Capacitor calls a method through the selector "<name>:"; a missing @objc compiles fine and fails on the phone.
        for name in methods {
            XCTAssertTrue(LaunchDarklyPlugin().responds(to: NSSelectorFromString("\(name):")), name)
        }
    }

    func testShipsAPrivacyManifestDeclaringUserDefaults() throws {
        let bundle = Bundle.module
        let url = try XCTUnwrap(bundle.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"))
        let text = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(text.contains("NSPrivacyAccessedAPICategoryUserDefaults"))
        XCTAssertTrue(text.contains("CA92.1"))
    }
}
