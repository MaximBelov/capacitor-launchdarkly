import XCTest
import LaunchDarkly
@testable import LaunchDarklyPlugin

// Offline first: getState() answers what the SDK has, at once, and identify() never outlives its timeout or fails for the
// network.
final class OfflineTests: XCTestCase {
    private struct FakeReader: FlagReading {
        let storedFlags: [String: LDValue]
    }

    private let cached: [String: LDValue] = ["on": .bool(true), "theme": .string("green")]

    func testWithoutAClientThereIsNothing() {
        XCTAssertEqual(StateReader.read(nil, answered: false, contextJSON: nil), .empty)
    }

    func testBeforeAnAnswerTheCachedFlagsAreAnsweredAsNotInitialised() {
        let state = StateReader.read(FakeReader(storedFlags: cached), answered: false, contextJSON: #"{"kind":"user","key":"u1"}"#)
        XCTAssertFalse(state.initialized)
        XCTAssertEqual(state.source, .cache)
        XCTAssertEqual(state.flags, cached)
        XCTAssertEqual(state.dictionary["source"] as? String, "cache")
        XCTAssertEqual((state.dictionary["context"] as? [String: Any])?["key"] as? String, "u1")
    }

    func testNoAnswerAndNoCacheIsNone() {
        XCTAssertEqual(StateReader.read(FakeReader(storedFlags: [:]), answered: false, contextJSON: nil).source, .none)
    }

    func testAnAnswerIsTheNetwork() {
        let state = StateReader.read(FakeReader(storedFlags: cached), answered: true, contextJSON: nil)
        XCTAssertTrue(state.initialized)
        XCTAssertEqual(state.source, .network)
    }

    func testOnlyACompletionWhileOnlineIsAnAnswer() {
        XCTAssertFalse(IdentifyOutcome.timedOut(.complete, isOnline: true))
        XCTAssertTrue(IdentifyOutcome.timedOut(.complete, isOnline: false))
        XCTAssertTrue(IdentifyOutcome.timedOut(.timeout, isOnline: true))
        XCTAssertTrue(IdentifyOutcome.timedOut(.error, isOnline: true))
        XCTAssertTrue(IdentifyOutcome.timedOut(.shed, isOnline: true))
    }
}

// The same against the real SDK, pointed at an address nothing listens on, which is how a phone without network looks to it.
final class OfflineClientTests: XCTestCase {
    private var store: UserDefaultsContextStore!
    private let client = LaunchDarklyClient.shared
    private let anonymous = #"{"kind":"user","key":"anonymous_user","anonymous":true}"#

    override func setUp() {
        super.setUp()
        store = UserDefaultsContextStore(defaults: UserDefaults(suiteName: "OfflineClientTests-\(UUID().uuidString)")!)
        client.configure = { config in
            let nowhere = URL(string: "http://127.0.0.1:9")!
            config.baseUrl = nowhere
            config.streamUrl = nowhere
            config.eventsUrl = nowhere
            config.sendEvents = false
        }
    }

    override func tearDown() {
        client.close()
        client.configure = nil
        super.tearDown()
    }

    private func start(offline: Bool = false) throws {
        var options = StartOptions(mobileKey: "mob-offline-test-\(UUID().uuidString)")
        options.offline = offline
        client.start(options, context: ContextChoice(context: try Contexts.parse(anonymous), json: anonymous))
    }

    func testTheStateIsThereAsSoonAsStartReturnsWithoutTheNetwork() throws {
        let began = Date()
        try start()
        let state = client.state
        XCTAssertLessThan(Date().timeIntervalSince(began), 1)
        XCTAssertFalse(state.initialized)
        XCTAssertEqual(state.source, .none)
        XCTAssertEqual(state.contextJSON, anonymous)
    }

    func testIdentifyWithoutTheNetworkResolvesTimedOutWithinItsTimeoutAndKeepsTheContext() throws {
        try start()
        let user = #"{"kind":"user","key":"user-42"}"#
        let done = expectation(description: "identify")
        let began = Date()
        var outcome: Result<Bool, Error>?
        client.identify(ContextChoice(context: try Contexts.parse(user), json: user), timeout: 0.5, store: store) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 5)
        XCTAssertLessThan(Date().timeIntervalSince(began), 2.5)
        XCTAssertEqual(try outcome?.get(), true)
        XCTAssertEqual(store.read(), user)
        XCTAssertEqual(client.state.contextJSON, user)
    }

    func testIdentifyOfflineResolvesTimedOutAtOnce() throws {
        try start(offline: true)
        let user = #"{"kind":"user","key":"user-43"}"#
        let done = expectation(description: "identify")
        var outcome: Result<Bool, Error>?
        client.identify(ContextChoice(context: try Contexts.parse(user), json: user), timeout: 5, store: store) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 2)
        XCTAssertEqual(try outcome?.get(), true)
        XCTAssertEqual(store.read(), user)
    }

    func testAClientStartedOfflineIsNotInitialisedEvenThoughTheSdkSaysSo() throws {
        try start(offline: true)
        XCTAssertFalse(client.state.initialized)
    }

    func testWaitForInitializationWithoutTheNetworkAnswersFalseAfterItsTimeout() throws {
        try start()
        let done = expectation(description: "wait")
        var initialized: Bool?
        client.waitForInitialization(timeout: 0.3) {
            initialized = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 3)
        XCTAssertEqual(initialized, false)
    }
}
