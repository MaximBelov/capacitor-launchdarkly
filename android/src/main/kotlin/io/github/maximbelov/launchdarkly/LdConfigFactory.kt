package io.github.maximbelov.launchdarkly

import com.launchdarkly.sdk.android.Components
import com.launchdarkly.sdk.android.LDConfig

/**
 * Builds the SDK configuration. Two settings here are not options, because LaunchDarkly bills client-side SDKs by the number
 * of unique context keys (of the kind that has the most):
 *
 * - Automatic environment attributes are disabled. Enabled, the SDK adds `ld_application` and `ld_device` contexts to every
 *   evaluation, and the `ld_device` key is generated per install, which counts every device as a context of its own.
 * - Anonymous keys are not generated. Enabled, the SDK replaces the key of every anonymous context with a key generated per
 *   install (`AnonymousKeyContextModifier`), so an app that shares one anonymous key across all its installs would again count
 *   one context per device. The SDK's default is already false; it is set anyway, so a change of default cannot move it.
 */
object LdConfigFactory {
    fun build(options: StartOptions): LDConfig {
        val builder = LDConfig.Builder(LDConfig.Builder.AutoEnvAttributes.Disabled)
            .mobileKey(options.mobileKey)
            .generateAnonymousKeys(false)
            .evaluationReasons(options.evaluationReasons)
            .offline(options.offline)
            .dataSource(if (options.streaming) Components.streamingDataSource() else Components.pollingDataSource())
        options.application?.let { app ->
            val info = Components.applicationInfo()
            app.id?.let { info.applicationId(it) }
            app.name?.let { info.applicationName(it) }
            app.version?.let { info.applicationVersion(it) }
            app.versionName?.let { info.applicationVersionName(it) }
            builder.applicationInfo(info)
        }
        return builder.build()
    }
}
