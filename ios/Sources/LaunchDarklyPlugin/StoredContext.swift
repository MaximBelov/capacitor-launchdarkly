import Foundation
import LaunchDarkly

/// Where the context of the last `identify()` is kept between launches.
public protocol ContextStore: AnyObject {
    func read() -> String?
    func write(_ json: String)
    func clear()
}

/// `ContextStore` in `UserDefaults`, under a key of the plugin's own.
public final class UserDefaultsContextStore: ContextStore {
    public static let key = "CapacitorLaunchDarkly.context"
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func read() -> String? { defaults.string(forKey: Self.key) }
    public func write(_ json: String) { defaults.set(json, forKey: Self.key) }
    public func clear() { defaults.removeObject(forKey: Self.key) }
}

/// A context and the JSON it was read from, which is what the plugin stores and answers in `getState()`.
public struct ContextChoice {
    public let context: LDContext
    public let json: String
}

public enum StartContext {
    /// The context a native start-up begins with: the stored one when there is a valid one, so the app does not flip to the
    /// initial (usually anonymous) context for a moment and the SDK uses its flag cache for that context; else
    /// `initialContext`; else the default anonymous context.
    public static func choose(stored: String?, initialContext: String) -> ContextChoice {
        for json in [stored, initialContext, PluginConfiguration.defaultInitialContext] {
            if let json, let context = Contexts.parseOrNil(json) {
                return ContextChoice(context: context, json: json)
            }
        }
        fatalError("the default context is not valid")
    }
}
