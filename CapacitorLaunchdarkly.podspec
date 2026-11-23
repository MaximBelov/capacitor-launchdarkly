require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'CapacitorLaunchdarkly'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = package['repository']['url']
  s.author = package['author']
  s.source = { :git => package['repository']['url'], :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.resource_bundles = { 'CapacitorLaunchdarkly' => ['ios/Sources/LaunchDarklyPlugin/PrivacyInfo.xcprivacy'] }
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  # The LaunchDarkly iOS client SDK, pinned to the version the plugin is tested with (the same as in Package.swift).
  s.dependency 'LaunchDarkly', '11.8.1'
  s.swift_version = '5.1'
end
