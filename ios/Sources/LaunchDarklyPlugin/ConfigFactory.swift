import Foundation
import LaunchDarkly

/// Builds the SDK configuration. Two settings here are not options, because LaunchDarkly bills client-side SDKs by the number
/// of unique context keys (of the kind that has the most):
///
/// - Automatic environment attributes are disabled. Enabled, the SDK adds `ld_application` and `ld_device` contexts to every
///   context it evaluates (`AutoEnvContextModifier`), and the `ld_device` key is generated per install, which counts every
///   device as a context of its own.
/// - Keys are never generated. The iOS SDK generates a key only for a context built without one (`LDContextBuilder()` with no
///   key, or a start with no context at all, which falls back to `LDContext()`); it has no setting that replaces the key of an
///   anonymous context. The plugin always builds contexts from JSON with the caller's key and always starts with a context.
public enum ConfigFactory {
    public static func make(_ options: StartOptions) -> LDConfig {
        var config = LDConfig(mobileKey: options.mobileKey, autoEnvAttributes: .disabled)
        config.streamingMode = options.streaming ? .streaming : .polling
        config.evaluationReasons = options.evaluationReasons
        config.startOnline = !options.offline
        if let app = options.application {
            var info = ApplicationInfo()
            info.applicationIdentifier(app.id)
            info.applicationName(app.name)
            info.applicationVersion(app.version)
            info.applicationVersionName(app.versionName)
            config.applicationInfo = info
        }
        return config
    }
}
