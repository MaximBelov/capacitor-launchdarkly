import Foundation

/// Application metadata sent with every request. It describes the app; it is not a context.
public struct ApplicationMetadata: Equatable {
    public var id: String?
    public var name: String?
    public var version: String?
    public var versionName: String?
}

/// How the client is started: from `plugins.LaunchDarkly` in capacitor.config, or from `initialize()`.
public struct StartOptions: Equatable {
    public static let defaultWaitSeconds: TimeInterval = 5

    public var mobileKey: String
    public var streaming = true
    public var evaluationReasons = false
    public var offline = false
    public var startWaitSeconds: TimeInterval = StartOptions.defaultWaitSeconds
    public var application: ApplicationMetadata?

    public init(mobileKey: String) {
        self.mobileKey = mobileKey
    }

    /// The options of `initialize()` or of the config block, everything but the key and the context.
    public init(mobileKey: String, options config: [String: Any]?) {
        self.mobileKey = mobileKey
        let config = config ?? [:]
        streaming = config["streaming"] as? Bool ?? true
        evaluationReasons = config["evaluationReasons"] as? Bool ?? false
        offline = config["offline"] as? Bool ?? false
        startWaitSeconds = StartOptions.seconds(config["startWaitSeconds"])
        if let app = config["application"] as? [String: Any] {
            application = ApplicationMetadata(
                id: nonBlank(app["id"]),
                name: nonBlank(app["name"]),
                version: nonBlank(app["version"]),
                versionName: nonBlank(app["versionName"])
            )
        }
    }

    /// A wait in seconds as given, or the default when it is not a usable number.
    public static func seconds(_ value: Any?, default fallback: TimeInterval = defaultWaitSeconds) -> TimeInterval {
        // A JavaScript boolean arrives as an NSNumber too; it is not a number of seconds.
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return fallback }
        let seconds = number.doubleValue
        return seconds.isFinite && seconds >= 0 ? seconds : fallback
    }
}

/// What the native start-up does when the app launches: start with `options` and `initialContext` unless a context was stored.
public struct AutoStart: Equatable {
    public var options: StartOptions
    public var initialContext: String
}

public enum PluginConfiguration {
    /// The context of a native start-up that has neither a stored context nor an `initialContext`.
    public static let defaultInitialContext = #"{"kind":"user","key":"anonymous_user","anonymous":true}"#

    /// Reads the `plugins.LaunchDarkly` block of capacitor.config. Without a `mobileKey` there is no native start-up, and the
    /// answer is nil: the app starts the client with `initialize()` instead.
    public static func autoStart(_ config: [String: Any]?) -> AutoStart? {
        guard let config, let mobileKey = nonBlank(config["mobileKey"]) else { return nil }
        var initialContext = defaultInitialContext
        if let context = config["initialContext"] as? [String: Any], let json = JSONText.from(context) {
            initialContext = json
        }
        return AutoStart(options: StartOptions(mobileKey: mobileKey, options: config), initialContext: initialContext)
    }
}

/// A string value, or nil when it is absent, not a string, or blank.
func nonBlank(_ value: Any?) -> String? {
    guard let string = value as? String, !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    return string
}
