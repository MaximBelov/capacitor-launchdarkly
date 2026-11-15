import XCTest
@testable import LaunchDarklyPlugin

final class StartContextTests: XCTestCase {
    private let initial = #"{"kind":"user","key":"anonymous_user","anonymous":true}"#
    private let stored = #"{"kind":"user","key":"user-42","name":"Ann"}"#

    func testAStoredContextWinsOverTheInitialOne() {
        let choice = StartContext.choose(stored: stored, initialContext: initial)
        XCTAssertEqual(choice.context.fullyQualifiedKey(), "user-42")
        XCTAssertEqual(choice.json, stored)
    }

    func testWithoutAStoredContextTheInitialOneIsUsed() {
        XCTAssertEqual(StartContext.choose(stored: nil, initialContext: initial).context.fullyQualifiedKey(), "anonymous_user")
    }

    func testAnInvalidStoredContextFallsBackToTheInitialOne() {
        XCTAssertEqual(StartContext.choose(stored: #"{"kind":"user"}"#, initialContext: initial).json, initial)
        XCTAssertEqual(StartContext.choose(stored: "not json", initialContext: initial).json, initial)
    }

    func testAnInvalidInitialContextFallsBackToTheDefault() {
        XCTAssertEqual(StartContext.choose(stored: nil, initialContext: #"{"kind":"multi"}"#).json, PluginConfiguration.defaultInitialContext)
    }

    func testTheUserDefaultsStoreKeepsWritesAndClears() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "StartContextTests-\(UUID().uuidString)"))
        let store = UserDefaultsContextStore(defaults: defaults)
        XCTAssertNil(store.read())
        store.write(stored)
        XCTAssertEqual(UserDefaultsContextStore(defaults: defaults).read(), stored)
        store.clear()
        XCTAssertNil(store.read())
    }
}
