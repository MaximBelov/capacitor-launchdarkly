import Foundation
import LaunchDarkly

/// Where the client's events go: the plugin instance of the current bridge.
protocol ClientEvents: AnyObject {
    func flagChanged(key: String, value: LDValue, previous: LDValue?)
    func connectionModeChanged(_ mode: String)
}

/// The one LaunchDarkly client of the process. It outlives a plugin instance, while the SDK keeps one client per process.
///
/// Offline first: nothing here waits for the network unless the caller asked to (`waitForInitialization`, the timeout of
/// `identify`). `LDClient.start` creates the client before it returns, and the client's initialiser loads the flags cached for
/// the context into its store before it goes online, so the state is readable straight after `start`; the network answer
/// arrives later as `flagChange` events.
///
/// Every SDK call and every piece of state here is on the main queue: the SDK delivers its completions and observer callbacks
/// there, so keeping to it leaves nothing to race. Capacitor calls plugin methods on a queue of its own, and the plugin hops to
/// main with `LaunchDarklyClient.onMain`.
final class LaunchDarklyClient {
    static let shared = LaunchDarklyClient()

    weak var events: ClientEvents?

    /// Applied to every configuration the client is started with. Tests use it to point the SDK at an address that does not
    /// answer, which is how a phone without network looks to it.
    var configure: ((inout LDConfig) -> Void)?

    private(set) var options: StartOptions?
    private(set) var contextJSON: String?
    /// Whether LaunchDarkly answered since this client was started, as seen by the plugin (see `noteAnswer`).
    private var answered = false
    /// Set once the client is taken offline. The SDK then counts itself initialised (`go(online: false)` sets its
    /// `initialized`), which says nothing about an answer, so from then on only an observed answer counts.
    private var wentOffline = false
    /// The owner of the SDK observers; replaced on every start so a closed client's observers are dropped with it.
    private var observerOwner = NSObject()

    private init() {}

    static func onMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
    }

    private var client: LDClient? { options == nil ? nil : LDClient.get() }

    /// Starts the client unless one with the same mobile key is running; one with another key is closed first. Returns once
    /// the client exists, which is local work; it does not wait for LaunchDarkly.
    func start(_ options: StartOptions, context: ContextChoice) {
        dispatchPrecondition(condition: .onQueue(.main))
        if self.options?.mobileKey == options.mobileKey { return }
        startNow(options, context: context)
    }

    private func startNow(_ options: StartOptions, context: ContextChoice) {
        if self.options != nil { closeNow() }
        self.options = options
        contextJSON = context.json
        answered = false
        wentOffline = options.offline
        let owner = NSObject()
        observerOwner = owner
        var config = ConfigFactory.make(options)
        configure?(&config)
        // A start wait of zero and no completion: start() creates the client synchronously (TimeoutExecutor runs the
        // operation in place), so the client and its cached flags are there when it returns. Nothing waits for the network.
        LDClient.start(config: config, context: context.context, startWaitSeconds: 0)
        observe(owner: owner)
    }

    private func observe(owner: NSObject) {
        guard let client else { return }
        client.observeAll(owner: owner) { [weak self] changes in
            for (key, change) in changes.sorted(by: { $0.key < $1.key }) {
                self?.events?.flagChanged(key: key, value: change.newValue, previous: change.oldValue == .null ? nil : change.oldValue)
            }
        }
        // Called only when a poll or the stream answered with the flags unchanged: an answer.
        client.observeFlagsUnchanged(owner: owner) { [weak self] in
            self?.answered = true
        }
        client.observeCurrentConnectionMode(owner: owner) { [weak self] mode in
            self?.events?.connectionModeChanged(mode.rawValue)
        }
    }

    /// Recreates the running client with `change` applied to its options, keeping the current context.
    func restart(_ change: (StartOptions) -> StartOptions) throws {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let options, let contextJSON else { throw PluginError.notStarted }
        let context = ContextChoice(context: try Contexts.parse(contextJSON), json: contextJSON)
        startNow(change(options), context: context)
    }

    /// Whether LaunchDarkly answered in this process: observed by the plugin, or reported by the SDK while it has been
    /// online the whole time (its `isInitialized` turns true on the first answer, and on going offline).
    private var hasAnswered: Bool {
        guard let client else { return false }
        if !answered && !wentOffline && client.isOnline && client.isInitialized {
            answered = true
        }
        return answered
    }

    /// The state now, from the SDK's store. Never waits.
    var state: ClientState {
        StateReader.read(client, answered: hasAnswered, contextJSON: contextJSON)
    }

    /// Switches the context; `done` gets whether its flags did not arrive from LaunchDarkly within `timeout` (offline
    /// included). The SDK loads the new context's cached flags into its store as it switches (`useCache: .yes`), before it asks
    /// the network. Never fails for the network.
    func identify(_ context: ContextChoice, timeout: TimeInterval, store: ContextStore, done: @escaping (Result<Bool, Error>) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let client else { return done(.failure(PluginError.notStarted)) }
        contextJSON = context.json
        store.write(context.json)
        client.identify(context: context.context, timeout: timeout) { [weak self] result in
            Self.onMain {
                let online = self?.client?.isOnline == true
                if result == .complete && online { self?.answered = true }
                done(.success(IdentifyOutcome.timedOut(result, isOnline: online)))
            }
        }
    }

    /// Answers whether LaunchDarkly answered in this process, waiting up to `timeout` for it.
    func waitForInitialization(timeout: TimeInterval, answer: @escaping (Bool) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard options != nil else { return answer(false) }
        let deadline = Date().addingTimeInterval(timeout)
        func check() {
            if hasAnswered { return answer(true) }
            if options == nil || Date() >= deadline { return answer(false) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: check)
        }
        check()
    }

    /// Every flag from the SDK's store; reading them this way records no evaluation event.
    var allFlags: [String: LDValue] { client?.storedFlags ?? [:] }

    func variation(_ key: String, defaultValue: LDValue) -> LDValue {
        client?.jsonVariation(forKey: key, defaultValue: defaultValue) ?? defaultValue
    }

    /// Takes the client online or offline and returns at once: the SDK's completion for going online waits for LaunchDarkly
    /// to answer, which offline never happens, so it only records the answer when it comes.
    func setOnline(_ online: Bool) {
        guard let client else { return }
        if !online { wentOffline = true }
        let owner = observerOwner
        client.setOnline(online) { [weak self] in
            guard let self, online, self.observerOwner === owner else { return }
            self.answered = true
        }
    }

    func flush() {
        client?.flush()
    }

    func close() {
        dispatchPrecondition(condition: .onQueue(.main))
        closeNow()
    }

    private func closeNow() {
        LDClient.get()?.stopObserving(owner: observerOwner)
        LDClient.get()?.close()
        observerOwner = NSObject()
        options = nil
        contextJSON = nil
        answered = false
        wentOffline = false
    }
}
