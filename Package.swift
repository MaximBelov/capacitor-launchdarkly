// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapacitorLaunchdarkly",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorLaunchdarkly",
            targets: ["LaunchDarklyPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        // The LaunchDarkly iOS client SDK, pinned to the version the plugin is tested with.
        .package(url: "https://github.com/launchdarkly/ios-client-sdk.git", exact: "11.8.1")
    ],
    targets: [
        .target(
            name: "LaunchDarklyPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "LaunchDarkly", package: "ios-client-sdk")
            ],
            path: "ios/Sources/LaunchDarklyPlugin",
            resources: [.copy("PrivacyInfo.xcprivacy")]),
        .testTarget(
            name: "LaunchDarklyPluginTests",
            dependencies: ["LaunchDarklyPlugin"],
            path: "ios/Tests/LaunchDarklyPluginTests")
    ]
)
