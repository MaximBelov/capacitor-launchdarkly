// scripts/check-pins.mjs says where each native SDK pin stands against its latest release, and opens a pull request when one is
// behind. What it can do without the network is here, including a bump on the files of this repository, so a format that drifts away
// from what the script looks for fails here and not on a Monday.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  SDKS,
  assess,
  bump,
  compareVersions,
  decide,
  describePullRequest,
  folderVersions,
  latestStable,
  mavenVersions,
  propose,
  readPin,
  superseded,
  versionOf,
} from '../../scripts/check-pins.mjs';

/** What a bump of each SDK writes: the pin, what has to name the same version, and the README lines that name the SDK and its version. */
const WRITES: Record<string, string[]> = {
  'launchdarkly-ios-client-sdk': ['Package.swift', 'CapacitorLaunchdarkly.podspec', 'README.md'],
  'launchdarkly-android-client-sdk': ['android/build.gradle', 'README.md'],
};

const root = join(__dirname, '../..');
const real = (file: string) => readFileSync(join(root, file), 'utf8');
const sdk = (name: string) => SDKS.find((each) => each.name === name) ?? expect.fail(`no SDK called ${name}`);

/** This repository's files, with what was written kept apart. */
function tree() {
  const written = new Map<string, string>();
  return {
    read: (file: string) => written.get(file) ?? real(file),
    write: (file: string, text: string) => written.set(file, text),
    written,
  };
}

/** An SDK of made-up files, for what this repository's own files cannot show. */
const fake = {
  name: 'Example',
  releases: { kind: 'github', repo: 'example/example' },
  notes: (version: string) => `https://example.com/${version}`,
  file: 'Package.swift',
  pin: /example\.git", exact: "([\d.]+)"/,
  followers: [
    { file: 'Example.podspec', pin: /'Example', '~> ([\d.]+)'/, format: (v: string) => v.replace(/\.\d+$/, '') },
  ],
  mention: /Example/,
} as const;

function fakeFiles(entries: [string, string][]) {
  const files = new Map(entries);
  return {
    files,
    read: (file: string) => files.get(file) ?? '',
    write: (file: string, text: string) => files.set(file, text),
  };
}

describe('scripts/check-pins.mjs', () => {
  it('pins exactly the SDKs it is expected to', () => {
    expect(SDKS.map((each) => each.name)).toEqual(Object.keys(WRITES));
  });

  it('compares versions as numbers, so 9.9.0 is older than 9.30.0', () => {
    expect(compareVersions('9.9.0', '9.30.0')).toBeLessThan(0);
    expect(compareVersions('10.0.0', '9.30.0')).toBeGreaterThan(0);
    expect(compareVersions('9.30.0', '9.30.0')).toBe(0);
  });

  it('reads each pin from this repository, and what has to name the same version names it', () => {
    for (const each of SDKS) {
      const pinned = readPin(each);
      expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
      for (const { format = (version: string) => version, ...follower } of each.followers) {
        expect(readPin({ ...follower, name: each.name }), follower.file).toBe(format(pinned));
      }
    }
  });

  it('takes only a release tag of three numbers', () => {
    expect(versionOf('11.8.0')).toBe('11.8.0');
    expect(versionOf('v11.8.0')).toBe('11.8.0');
    for (const tag of ['11.8', '12.0.0-beta.1', 'latest', '11.8.0; rm -rf']) {
      expect(() => versionOf(tag)).toThrow(/not a version of three numbers/);
    }
  });

  it('takes the newest stable version of a Maven metadata file or a folder listing, passing over previews', () => {
    const metadata = `<metadata><versioning><latest>26.0.0-alpha02</latest><versions>
      <version>25.0.1</version><version>25.1.0-rc02</version><version>25.10.0</version>
      <version>25.9.0</version><version>26.0.0-alpha02</version></versions></versioning></metadata>`;
    expect(latestStable(mavenVersions(metadata))).toBe('25.10.0');
    const listing = { prefixes: ['release/a/sdk/56.5.1/', 'release/a/sdk/56.10.0/', 'release/a/sdk/57.0.0-beta/'] };
    expect(latestStable(folderVersions(listing))).toBe('56.10.0');
    expect(() => latestStable(['1.0.0-beta01'])).toThrow(/no stable version/);
    expect(() => latestStable(folderVersions({}))).toThrow(/no stable version/);
  });

  it('names the pull request of a pin that is behind, and says when a release is a major one', () => {
    const [first] = SDKS;
    expect(assess(first, '1.2.3', '2.0.0')).toMatchObject({
      behind: true,
      major: true,
      title: `Take ${first.name} 2.0.0`,
      branch: `pin-${first.name}-2.0.0`,
    });
    expect(assess(first, '1.2.3', '1.3.0')).toMatchObject({ behind: true, major: false });
    expect(assess(first, '1.2.3', '1.2.3').behind).toBe(false);
  });

  for (const [name, files] of Object.entries(WRITES)) {
    it(`moves ${name} in this repository's files: ${files.join(', ')}`, () => {
      const each = sdk(name);
      const files_ = tree();
      const pinned = readPin(each);
      expect(bump(each, pinned, '99.0.0', files_)).toEqual(files);
      expect(readPin(each, files_.read)).toBe('99.0.0');
      for (const { format = (version: string) => version, ...follower } of each.followers) {
        expect(readPin({ ...follower, name }, files_.read), follower.file).toBe(format('99.0.0'));
      }
      if (files.includes('README.md')) {
        const moved = files_.written.get('README.md') ?? '';
        expect(moved.split('\n').filter((line) => each.mention.test(line) && line.includes(pinned))).toEqual([]);
      }
    });
  }

  it('leaves a follower alone when the part of the version it names does not change, and moves it when it does', () => {
    const io = fakeFiles([
      ['Package.swift', '.package(url: "https://github.com/example/example.git", exact: "1.2.3")'],
      ['Example.podspec', "s.dependency 'Example', '~> 1.2'"],
      ['README.md', 'Example 1.2.3, and 1.2.3 elsewhere\n'],
    ]);
    expect(bump(fake as never, '1.2.3', '1.2.4', io)).toEqual(['Package.swift', 'README.md']);
    expect(io.files.get('Example.podspec')).toBe("s.dependency 'Example', '~> 1.2'");
    expect(io.files.get('README.md')).toBe('Example 1.2.4, and 1.2.4 elsewhere\n');
    expect(bump(fake as never, '1.2.4', '1.3.0', io)).toEqual(['Package.swift', 'Example.podspec', 'README.md']);
    expect(io.files.get('Example.podspec')).toBe("s.dependency 'Example', '~> 1.3'");
  });

  it('refuses a follower that names another version, and a file that names none', () => {
    const io = fakeFiles([
      ['Package.swift', '.package(url: "https://github.com/example/example.git", exact: "1.2.3")'],
      ['Example.podspec', "s.dependency 'Example', '~> 1.1'"],
    ]);
    expect(() => bump(fake as never, '1.2.3', '1.3.0', io)).toThrow(/pins 1\.1, not 1\.2/);
    const none = fakeFiles([['Package.swift', 'no pin here']]);
    expect(() => bump(fake as never, '1.2.3', '1.2.4', none)).toThrow(/did not change/);
  });

  it('leaves a version alone that already has a pull request in any state, and replaces an older open one', () => {
    const [first] = SDKS;
    const result = assess(first, '1.0.0', '1.2.0');
    const pulls = [
      { number: 3, title: `Take ${first.name} 1.1.0`, state: 'OPEN', headRefName: `pin-${first.name}-1.1.0` },
      { number: 4, title: `Take ${first.name} 1.2.0`, state: 'CLOSED', headRefName: `pin-${first.name}-1.2.0` },
    ];
    expect(decide(result, pulls).open).toBe(false);
    expect(decide(result, pulls.slice(0, 1)).open).toBe(true);
    expect(superseded(result, pulls).map((pull) => pull.number)).toEqual([3]);
  });

  it('says what a major release means and links the CI run in the description', () => {
    const [first] = SDKS;
    const run = 'https://github.com/owner/repo/actions/runs/1';
    const body = describePullRequest(first, assess(first, '1.0.0', '2.0.0'), ['a', 'b'], run);
    expect(body).toContain(first.notes('2.0.0'));
    expect(body).toContain('This is a major release');
    expect(body).toContain(run);
    expect(describePullRequest(first, assess(first, '1.0.0', '1.1.0'), ['a'])).not.toContain('major release');
  });

  it('opens a pull request on its own branch, starts CI there first, and goes back to where it started', () => {
    const [first] = SDKS;
    const files = tree();
    const commands: string[] = [];
    const full: string[] = [];
    propose([{ sdk: first, result: assess(first, readPin(first), '99.0.0') }], {
      exec: () => '[]',
      act: (command, args) => {
        commands.push([command, ...args.slice(0, 3)].join(' '));
        full.push([command, ...args].join(' '));
        return command === 'gh' && args[0] === 'workflow' ? 'https://github.com/owner/repo/actions/runs/7\n' : '';
      },
      files,
      head: 'abc',
    });
    expect(commands).toEqual([
      `git switch --create pin-${first.name}-99.0.0`,
      `git add -- ${first.file}`,
      'git -c user.name=github-actions[bot] -c',
      'git push --set-upstream origin',
      'gh workflow run ci.yaml',
      'gh pr create --base',
      'git switch --detach abc',
    ]);
    const create = full.find((line) => line.startsWith('gh pr create')) ?? '';
    expect(create).toContain(`--base main --head pin-${first.name}-99.0.0`);
    expect(create).toContain('https://github.com/owner/repo/actions/runs/7');
  });
});
