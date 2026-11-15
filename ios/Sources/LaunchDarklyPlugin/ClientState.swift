import Foundation
import LaunchDarkly

/// Where the flags `getState()` answers came from.
public enum FlagSource: String {
    /// LaunchDarkly answered in this process.
    case network
    /// Not yet: the values the SDK cached on the device for this context on an earlier run.
    case cache
    /// Neither: no answer yet and nothing cached.
    case none
}

/// What `getState()` answers, read from the SDK without waiting for anything.
public struct ClientState: Equatable {
    public let initialized: Bool
    public let source: FlagSource
    public let flags: [String: LDValue]
    public let contextJSON: String?

    public static let empty = ClientState(initialized: false, source: .none, flags: [:], contextJSON: nil)

    /// The object `getState()` resolves with.
    public var dictionary: [String: Any] {
        var state: [String: Any] = [
            "initialized": initialized,
            "source": source.rawValue,
            "flags": JSValues.flags(flags)
        ]
        if let contextJSON, let context = try? JSONSerialization.jsonObject(with: Data(contextJSON.utf8)) {
            state["context"] = context
        }
        return state
    }
}

/// The reads the state needs, so that it can be built from a fake in a test.
public protocol FlagReading {
    /// Every flag in the SDK's store: the cached values right after `start`, fresh ones once LaunchDarkly answered.
    var storedFlags: [String: LDValue] { get }
}

extension LDClient: FlagReading {
    public var storedFlags: [String: LDValue] { allFlags ?? [:] }
}

public enum StateReader {
    /// The state as it is now. Never blocks: offline, before LaunchDarkly answered, it answers the flags the SDK loaded from
    /// its cache when the client was created, with `initialized` false and source `cache` (or `none` when nothing was cached).
    public static func read(_ reader: FlagReading?, answered: Bool, contextJSON: String?) -> ClientState {
        guard let reader else { return .empty }
        let flags = reader.storedFlags
        let source: FlagSource = answered ? .network : (flags.isEmpty ? .none : .cache)
        return ClientState(initialized: answered, source: source, flags: flags, contextJSON: contextJSON)
    }
}

public enum IdentifyOutcome {
    /// Whether the flags of the new context did NOT arrive from LaunchDarkly in time. The SDK completes an identify at once
    /// when the client is offline (`.complete` without asking the network), times it out when the network does not answer, and
    /// reports `.error` for a failed request; all of those answer true. Only a completion while online is an answer.
    public static func timedOut(_ result: IdentifyResult, isOnline: Bool) -> Bool {
        !(result == .complete && isOnline)
    }
}
