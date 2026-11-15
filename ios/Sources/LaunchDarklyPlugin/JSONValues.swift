import Foundation
import LaunchDarkly

public enum PluginError: LocalizedError, Equatable {
    case invalidContext(String)
    case notStarted

    public var errorDescription: String? {
        switch self {
        case .invalidContext(let reason): return "Invalid context: \(reason)"
        case .notStarted: return "The client is not started."
        }
    }
}

/// JSON text from what Capacitor hands over (dictionaries, arrays, strings, numbers, booleans, NSNull).
enum JSONText {
    static func from(_ value: Any) -> String? {
        guard JSONSerialization.isValidJSONObject([value]),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys]) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/// Contexts in the JSON shape LaunchDarkly's SDKs use, read by the SDK's own decoder, so custom attributes of any JSON type,
/// nested objects, `anonymous`, `name`, multi-contexts and `_meta.privateAttributes` mean what they mean to LaunchDarkly. The
/// key is taken as given: nothing here generates or replaces one.
public enum Contexts {
    public static func parse(_ json: String) throws -> LDContext {
        do {
            return try JSONDecoder().decode(LDContext.self, from: Data(json.utf8))
        } catch {
            throw PluginError.invalidContext(String(describing: error))
        }
    }

    public static func parseOrNil(_ json: String?) -> LDContext? {
        guard let json else { return nil }
        return try? parse(json)
    }

    /// The JSON of a context Capacitor handed over as a dictionary.
    public static func json(from object: [String: Any]) throws -> String {
        guard let json = JSONText.from(object) else { throw PluginError.invalidContext("not JSON") }
        return json
    }
}

/// Flag values between JavaScript and the SDK's `LDValue`, through JSON.
public enum JSValues {
    public static func toLDValue(_ value: Any?) -> LDValue {
        guard let value, !(value is NSNull), let json = JSONText.from(value),
              let decoded = try? JSONDecoder().decode(LDValue.self, from: Data(json.utf8)) else { return .null }
        return decoded
    }

    /// An `LDValue` as a value Capacitor can send to JavaScript; JSON null is `NSNull`.
    public static func toJS(_ value: LDValue?) -> Any {
        guard let value, value != .null,
              let data = try? JSONEncoder().encode(value),
              let object = try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed) else { return NSNull() }
        return object
    }

    public static func flags(_ values: [String: LDValue]) -> [String: Any] {
        values.mapValues { toJS($0) }
    }
}
