# Contributing

This guide provides instructions for contributing to this Capacitor plugin.

## Developing

### Local Setup

1. Fork and clone the repo.
1. Install the dependencies.

    ```shell
    npm install
    ```

1. Install SwiftLint if you're on macOS.

    ```shell
    brew install swiftlint
    ```

### Scripts

#### `npm run build`

Build the plugin web assets and generate plugin API documentation using [`@capacitor/docgen`](https://github.com/ionic-team/capacitor-docgen).

It will compile the TypeScript code from `src/` into ESM JavaScript in `dist/esm/`. These files are used in apps with bundlers when your plugin is imported.

Then, Rollup will bundle the code into a single file at `dist/plugin.js`. This file is used in apps without bundlers by including it as a script in `index.html`.

#### `npm run verify`

Build and validate the web and native projects.

This is useful to run in CI to verify that the plugin builds for all platforms.

#### `npm run lint` / `npm run fmt`

Check formatting and code quality, autoformat/autofix if possible.

The project is integrated with ESLint, Prettier, and SwiftLint. Using these tools is completely optional, but the [Capacitor Community](https://github.com/capacitor-community/) strives to have consistent code style and structure for easier cooperation.

#### `npm test`, `npm run test:parity`, `npm run test:android`, `npm run test:ios`

The unit tests of the TypeScript (the web implementation against a stand-in for the browser SDK), the parity check between the
TypeScript, the web, Swift, Kotlin and the README, JUnit on the JVM for Android, and XCTest on an iOS simulator.

#### `npm run example:android:build` / `npm run example:ios:build`

Install the example app with the plugin from this repository and build it, the way CI does.

## Moving the native SDKs

The LaunchDarkly SDK versions are pinned in three places, which move together: `android/build.gradle`
(`launchDarklyAndroidVersion`), `Package.swift` (`exact:`) and `CapacitorLaunchdarkly.podspec`. Update the version table at the
top of the README in the same change.

## Publishing

A release is a version bump in `package.json` merged to `main`: the `publish` job of `.github/workflows/ci.yaml` builds the
package from that commit and publishes it to npm with trusted publishing (no npm token). A push that keeps the version publishes
nothing.

> **Note**: The [`files`](https://docs.npmjs.com/cli/v7/configuring-npm/package-json#files) array in `package.json` specifies which files get published. If you rename files/directories or add files elsewhere, you may need to update it.
