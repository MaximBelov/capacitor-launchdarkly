import Foundation
import LaunchDarkly

/// Where the client's events go: the plugin instance of the current bridge.
protocol ClientEvents: AnyObject {
    func flagChanged(key: String, value: LDValue, previous: LDValue?)
    func connectionModeChanged(_ mode: String)
}

/// The one LaunchDarkly client of the process. It outlives a plugin instance, while the SDK keeps one client per process.
///
/// Every SDK call and every piece of state here is on the main queue: the SDK delivers its completions and observer callbacks
/// there, so keeping to it leaves nothing to race. Capacitor calls plugin methods on a queue of its own, and the plugin hops to
/// main with `LaunchDarklyClient.onMain`.
final class LaunchDarklyClient {
    static let shared = LaunchDarklyClient()

    weak var events: ClientEvents?

    private(set) var options: StartOptions?
    private(set) var contextJSON: String?
    private var starting = false
    private var afterStartQueue: [() -> Void] = []
    /// The owner of the SDK observers; replaced on every start so a closed client's observers are dropped with it.
    private var observerOwner = NSObject()

    private init() {}

    static func onMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
    }

    private var client: LDClient? { options == nil ? nil : LDClient.get() }

    /// Starts the client unless one with the same mobile key is running or starting; one with another key is closed first.
    /// `done` runs once the start has finished: the first flags are in or the wait is over.
    func start(_ options: StartOptions, context: ContextChoice, done: (() -> Void)? = nil) {
        dispatchPrecondition(condition: .onQueue(.main))
        if self.options?.mobileKey == options.mobileKey {
            afterStart { done?() }
            return
        }
        startNow(options, context: context, done: done)
    }

    private func startNow(_ options: StartOptions, context: ContextChoice, done: (() -> Void)?) {
        if self.options != nil { closeNow() }
        self.options = options
        contextJSON = context.json
        starting = true
        if let done { afterStartQueue.append(done) }
        let owner = NSObject()
        observerOwner = owner
        LDClient.start(config: ConfigFactory.make(options), context: context.context, startWaitSeconds: options.startWaitSeconds) { [weak self] _ in
            guard let self, self.observerOwner === owner else { return }
            self.starting = false
            let waiting = self.afterStartQueue
            self.afterStartQueue = []
            waiting.forEach { $0() }
        }
        // start() creates the client before it returns, so the observers are in place before the first flags can arrive.
        observe(owner: owner)
    }

    private func observe(owner: NSObject) {
        guard let client else { return }
        client.observeAll(owner: owner) { [weak self] changes in
            for (key, change) in changes.sorted(by: { $0.key < $1.key }) {
                self?.events?.flagChanged(key: key, value: change.newValue, previous: change.oldValue == .null ? nil : change.oldValue)
            }
        }
        client.observeCurrentConnectionMode(owner: owner) { [weak self] mode in
            self?.events?.connectionModeChanged(mode.rawValue)
        }
    }

    /// Restarts the running client with `change` applied to its options, keeping the current context.
    func restart(_ change: (StartOptions) -> StartOptions, done: @escaping (Error?) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let options, let contextJSON else { return done(PluginError.notStarted) }
        do {
            let context = ContextChoice(context: try Contexts.parse(contextJSON), json: contextJSON)
            startNow(change(options), context: context) { done(nil) }
        } catch {
            done(error)
        }
    }

    /// Runs `work` once the start has finished, or straight away when nothing is starting.
    func afterStart(_ work: @escaping () -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        if starting { afterStartQueue.append(work) } else { work() }
    }

    /// Switches the context; `done` gets whether the wait for its flags timed out, or the error.
    func identify(_ context: ContextChoice, timeout: TimeInterval, store: ContextStore, done: @escaping (Result<Bool, Error>) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        afterStart { [weak self] in
            guard let self, let client = self.client else { return done(.failure(PluginError.notStarted)) }
            client.identify(context: context.context, timeout: timeout) { result in
                Self.onMain {
                    switch result {
                    case .complete, .timeout:
                        // On a timeout the SDK has switched to the context and keeps loading its flags; only the wait is over.
                        self.contextJSON = context.json
                        store.write(context.json)
                        done(.success(result == .timeout))
                    case .shed:
                        done(.failure(NSError(domain: "LaunchDarkly", code: 1, userInfo: [NSLocalizedDescriptionKey: "identify was replaced by a later identify"])))
                    case .error:
                        done(.failure(NSError(domain: "LaunchDarkly", code: 2, userInfo: [NSLocalizedDescriptionKey: "identify failed"])))
                    }
                }
            }
        }
    }

    /// Answers whether the client has its first flags, waiting up to `timeout` for them.
    func waitForInitialization(timeout: TimeInterval, answer: @escaping (Bool) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard options != nil else { return answer(false) }
        let deadline = Date().addingTimeInterval(timeout)
        func check() {
            if client?.isInitialized == true { return answer(true) }
            if options == nil || Date() >= deadline { return answer(false) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: check)
        }
        check()
    }

    var isInitialized: Bool { client?.isInitialized == true }

    /// Every flag from the SDK's store; reading them this way records no evaluation event.
    var allFlags: [String: LDValue] { client?.allFlags ?? [:] }

    func variation(_ key: String, defaultValue: LDValue) -> LDValue {
        client?.jsonVariation(forKey: key, defaultValue: defaultValue) ?? defaultValue
    }

    func setOnline(_ online: Bool, done: @escaping () -> Void) {
        guard let client else { return done() }
        client.setOnline(online) { done() }
    }

    func flush() {
        client?.flush()
    }

    func close() {
        dispatchPrecondition(condition: .onQueue(.main))
        closeNow()
        let waiting = afterStartQueue
        afterStartQueue = []
        starting = false
        waiting.forEach { $0() }
    }

    private func closeNow() {
        LDClient.get()?.stopObserving(owner: observerOwner)
        LDClient.get()?.close()
        observerOwner = NSObject()
        options = nil
        contextJSON = nil
    }
}
