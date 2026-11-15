import Foundation
import Capacitor
import LaunchDarkly

@objc(LaunchDarklyPlugin)
public class LaunchDarklyPlugin: CAPPlugin, CAPBridgedPlugin, ClientEvents {
    public let identifier = "LaunchDarklyPlugin"
    public let jsName = "LaunchDarkly"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "waitForInitialization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "identify", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "variation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "allFlags", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setStreaming", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setOnline", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "flush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearStoredContext", returnType: CAPPluginReturnPromise)
    ]

    private let store: ContextStore = UserDefaultsContextStore()
    private var client: LaunchDarklyClient { LaunchDarklyClient.shared }

    /// Runs as the bridge is created, before the web view loads the app. With a `mobileKey` in `plugins.LaunchDarkly` of
    /// capacitor.config the client starts here, with the stored context or else `initialContext`, so the flags are on their way
    /// before any app code asks for them. Without one nothing starts, and `initialize()` does it.
    override public func load() {
        let config = getConfig().getConfigJSON() as [String: Any]
        let autoStart = PluginConfiguration.autoStart(config)
        LaunchDarklyClient.onMain { [weak self] in
            guard let self else { return }
            self.client.events = self
            guard let autoStart else { return }
            let context = StartContext.choose(stored: self.store.read(), initialContext: autoStart.initialContext)
            self.client.start(autoStart.options, context: context)
        }
    }

    @objc func initialize(_ call: CAPPluginCall) {
        guard let mobileKey = nonBlank(call.getString("mobileKey")) else {
            return call.reject("initialize needs a mobileKey on iOS.")
        }
        guard let given = readContext(call) else { return }
        let options = StartOptions(mobileKey: mobileKey, options: call.getObject("options"))
        LaunchDarklyClient.onMain { [store, client] in
            // One client per process: the same key changes nothing and answers the state once the start is done.
            if client.options?.mobileKey == mobileKey {
                return client.afterStart { call.resolve(Self.state(client)) }
            }
            // The given context plays the part of initialContext: a context an earlier identify() stored wins over it.
            let context = StartContext.choose(stored: store.read(), initialContext: given.json)
            client.start(options, context: context) { call.resolve(Self.state(client)) }
        }
    }

    @objc func waitForInitialization(_ call: CAPPluginCall) {
        let timeout = StartOptions.seconds(call.options["timeoutSeconds"])
        LaunchDarklyClient.onMain { [client] in
            client.waitForInitialization(timeout: timeout) { call.resolve(["initialized": $0]) }
        }
    }

    @objc func getState(_ call: CAPPluginCall) {
        LaunchDarklyClient.onMain { [client] in
            client.afterStart { call.resolve(Self.state(client)) }
        }
    }

    @objc func identify(_ call: CAPPluginCall) {
        guard let context = readContext(call) else { return }
        let timeout = StartOptions.seconds(call.options["timeoutSeconds"])
        LaunchDarklyClient.onMain { [store, client] in
            client.identify(context, timeout: timeout, store: store) { result in
                switch result {
                case .success(let timedOut): call.resolve(["timedOut": timedOut])
                case .failure(let error): call.reject(error.localizedDescription, nil, error)
                }
            }
        }
    }

    @objc func variation(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { return call.reject("variation needs a key.") }
        let defaultValue = JSValues.toLDValue(call.options["defaultValue"])
        LaunchDarklyClient.onMain { [client] in
            call.resolve(["value": JSValues.toJS(client.variation(key, defaultValue: defaultValue))])
        }
    }

    @objc func allFlags(_ call: CAPPluginCall) {
        LaunchDarklyClient.onMain { [client] in
            call.resolve(["flags": JSValues.flags(client.allFlags)])
        }
    }

    @objc func setStreaming(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else { return call.reject("setStreaming needs enabled.") }
        LaunchDarklyClient.onMain { [client] in
            client.restart({ options in
                var next = options
                next.streaming = enabled
                return next
            }, done: { error in
                if let error { call.reject(error.localizedDescription, nil, error) } else { call.resolve() }
            })
        }
    }

    @objc func setOnline(_ call: CAPPluginCall) {
        guard let online = call.getBool("online") else { return call.reject("setOnline needs online.") }
        LaunchDarklyClient.onMain { [client] in
            client.setOnline(online) { call.resolve() }
        }
    }

    @objc func flush(_ call: CAPPluginCall) {
        LaunchDarklyClient.onMain { [client] in
            client.flush()
            call.resolve()
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        LaunchDarklyClient.onMain { [client] in
            client.close()
            call.resolve()
        }
    }

    @objc func clearStoredContext(_ call: CAPPluginCall) {
        store.clear()
        call.resolve()
    }

    func flagChanged(key: String, value: LDValue, previous: LDValue?) {
        var change: [String: Any] = ["key": key, "value": JSValues.toJS(value)]
        if let previous { change["previous"] = JSValues.toJS(previous) }
        notifyListeners("flagChange", data: change)
    }

    func connectionModeChanged(_ mode: String) {
        notifyListeners("connectionModeChange", data: ["mode": mode])
    }

    private func readContext(_ call: CAPPluginCall) -> ContextChoice? {
        guard let object = call.getObject("context") else {
            call.reject("A context is needed.")
            return nil
        }
        do {
            let json = try Contexts.json(from: object)
            return ContextChoice(context: try Contexts.parse(json), json: json)
        } catch {
            call.reject(error.localizedDescription, nil, error)
            return nil
        }
    }

    static func state(_ client: LaunchDarklyClient) -> [String: Any] {
        var state: [String: Any] = ["initialized": client.isInitialized, "flags": JSValues.flags(client.allFlags)]
        if let json = client.contextJSON,
           let context = try? JSONSerialization.jsonObject(with: Data(json.utf8)) {
            state["context"] = context
        }
        return state
    }
}
