#!/usr/bin/env node
// The LaunchDarkly client SDKs are pinned exactly in this repository, and Dependabot moves neither pin: the iOS one is an `exact:` in
// Package.swift (with the podspec beside it), and the Android one an `ext` default in android/build.gradle, which it does not read. This
// compares each with the latest release of the SDK and says which are behind. `--pr` also opens a pull request that moves each pin that
// is behind, a major release included (the pull request is what says what a major breaks), and starts CI on its branch.
//
//   node scripts/check-pins.mjs                 print where each pin stands
//   node scripts/check-pins.mjs --pr            the same, and open a pull request per SDK that is behind (needs git, `gh`, GH_TOKEN)
//   node scripts/check-pins.mjs --pr --dry-run  the same, writing nothing: it says what it would write and run
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The branch a pull request goes to. */
const BASE = 'main';

/** Who the commit is from: the Actions bot, so it is not taken for the person who merges it. */
const BOT = [
  '-c',
  'user.name=github-actions[bot]',
  '-c',
  'user.email=41898282+github-actions[bot]@users.noreply.github.com',
];

const VERSION = /^\d+\.\d+\.\d+$/;

/**
 * The SDKs: where each is pinned and where its releases are. `followers` are the files that have to name the same version, and
 * `mention` picks the README lines that name the SDK, which are the ones that carry its version.
 */
export const SDKS = [
  {
    name: 'launchdarkly-ios-client-sdk',
    releases: { kind: 'github', repo: 'launchdarkly/ios-client-sdk' },
    notes: (version) => `https://github.com/launchdarkly/ios-client-sdk/releases/tag/${version}`,
    file: 'Package.swift',
    pin: /ios-client-sdk\.git", exact: "([\d.]+)"/,
    followers: [{ file: 'CapacitorLaunchdarkly.podspec', pin: /s\.dependency 'LaunchDarkly', '([\d.]+)'/ }],
    mention: /LaunchDarkly iOS client SDK/,
  },
  {
    name: 'launchdarkly-android-client-sdk',
    releases: {
      kind: 'maven',
      metadata: 'https://repo1.maven.org/maven2/com/launchdarkly/launchdarkly-android-client-sdk/maven-metadata.xml',
    },
    notes: (version) => `https://github.com/launchdarkly/android-client-sdk/releases/tag/${version}`,
    file: 'android/build.gradle',
    pin: /launchDarklyAndroidVersion = project\.hasProperty\('launchDarklyAndroidVersion'\) \? rootProject\.ext\.launchDarklyAndroidVersion : '([\d.]+)'/,
    followers: [],
    mention: /LaunchDarkly Android client SDK/,
  },
];

const readRoot = (file) => readFileSync(join(root, file), 'utf8');

/** The version a pin names, read out of the file that holds it. */
export function readPin(sdk, read = readRoot) {
  const version = sdk.pin.exec(read(sdk.file))?.[1];
  if (!version) {
    throw new Error(`${sdk.file} names no version for ${sdk.name}`);
  }
  return version;
}

/** Negative when a is older than b, zero when they are the same, positive when a is newer: numeric, so 9.9.0 is older than 9.30.0. */
export function compareVersions(a, b) {
  const [x, y] = [a, b].map((version) => version.split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const order = (x[i] ?? 0) - (y[i] ?? 0);
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}

/** A release tag as a version. Anything but three numbers is refused: it goes into a branch name, a file and a title. */
export function versionOf(tag) {
  const version = tag.replace(/^v/, '');
  if (!VERSION.test(version)) {
    throw new Error(`the release tag ${JSON.stringify(tag)} is not a version of three numbers`);
  }
  return version;
}

/** The newest stable version of a list: one of three numbers, so 1.12.0-alpha01 and 26.0.0-rc02 are passed over. */
export function latestStable(versions) {
  const stable = versions.filter((version) => VERSION.test(version));
  if (stable.length === 0) {
    throw new Error('no stable version is listed');
  }
  return stable.sort(compareVersions).at(-1);
}

/** The versions a Maven metadata file lists. */
export function mavenVersions(metadata) {
  return [...metadata.matchAll(/<version>([^<]+)<\/version>/g)].map((match) => match[1]);
}

/** The versions a Google Cloud Storage listing of a Maven artefact's folder holds: one folder per version, and no metadata file. */
export function folderVersions(listing) {
  return (listing.prefixes ?? []).map((prefix) => prefix.split('/').at(-2));
}

/** Where a pin stands against the latest release, and what a pull request that moves it is called. */
export function assess(sdk, pinned, latest) {
  const behind = compareVersions(pinned, latest) < 0;
  return {
    sdk: sdk.name,
    pinned,
    latest,
    behind,
    major: behind && Number(latest.split('.')[0]) > Number(pinned.split('.')[0]),
    line: `${sdk.name}: pinned ${pinned}, latest ${latest}${behind ? ' (behind)' : ''}`,
    title: `Take ${sdk.name} ${latest}`,
    // A flat name: git refuses every branch beneath one that exists.
    branch: `pin-${sdk.name}-${latest}`,
  };
}

const escape = (text) => text.replaceAll('.', '\\.');

/** Every version a pattern captures in a text, moved from one version to another; one that is not the version being moved is an error. */
function movePin(text, file, pin, from, to) {
  let moved = '';
  let last = 0;
  for (const match of text.matchAll(new RegExp(pin.source, 'gd'))) {
    const [start, end] = match.indices[1];
    if (match[1] !== from) {
      throw new Error(`${file} pins ${match[1]}, not ${from}`);
    }
    moved += text.slice(last, start) + to;
    last = end;
  }
  return moved + text.slice(last);
}

/**
 * Moves a pin, and what has to agree with it, from one version to another, through `read` and `write`, and says which files it wrote.
 * A file that does not change is an error, so a format that drifted away from what is looked for cannot pass as a bump that did nothing.
 * A follower with a `format` names less of the version (a CocoaPods `~> 56.6`), so a release that does not change that part leaves it.
 */
export function bump(sdk, from, to, { read, write }) {
  const written = new Set();
  for (const { file, pin, format = (version) => version } of [sdk, ...sdk.followers]) {
    const [was, is] = [format(from), format(to)];
    if (was === is) {
      continue;
    }
    const before = read(file);
    const after = movePin(before, file, pin, was, is);
    if (after === before) {
      throw new Error(`${file} did not change: it names no ${sdk.name} version to move`);
    }
    write(file, after);
    written.add(file);
  }
  // The README names the version in prose and in tables, on lines that name the SDK. Not every README mentions it, so none is no error.
  const old = new RegExp(`(?<![0-9])(?<![0-9]\\.)${escape(from)}(?![0-9])(?!\\.[0-9])`, 'g');
  const readme = read('README.md');
  const moved = readme
    .split('\n')
    .map((line) => (sdk.mention.test(line) ? line.replace(old, to) : line))
    .join('\n');
  if (moved !== readme) {
    write('README.md', moved);
    written.add('README.md');
  }
  return [...written];
}

/** The second paragraph of the commit message: where to read what changed. */
export function commitMessage(sdk, result) {
  return `Release notes: ${sdk.notes(result.latest)}`;
}

/** The description of a pull request for a bump that wrote these files; `run` is the link to the CI run that was started on its branch. */
export function describePullRequest(sdk, result, files, run) {
  return [
    `${sdk.name} ${result.latest} is out, and this plugin pinned ${result.pinned}: ${sdk.notes(result.latest)}`,
    `This moves the pin, what has to name the same version, and the README lines that name the SDK and its old version (${files.join(', ')}). What the release changes for this plugin is for whoever merges this to read in its notes; read the README lines it changed too, in case one is a statement about the old version.`,
    ...(result.major
      ? [
          'This is a major release, so it can change the API this plugin calls: a red check is the first thing to expect. The branch is an ordinary one, and the fix goes on it.',
        ]
      : []),
    run
      ? `CI was started on the branch by the workflow, as a workflow_dispatch of ci.yaml that tests everything and never publishes: ${run}. GitHub holds the pull_request run of a pull request that a workflow opened until someone approves it, so the list of checks on this page may not show CI: that run is the CI of this branch.`
      : 'CI was started on the branch by the workflow, as a workflow_dispatch of ci.yaml that tests everything and never publishes: look for it under Actions, on this branch.',
  ].join('\n\n');
}

/** Whether a pull request is to be opened, and if not, why not. A pull request of any state counts: closing one declines the version. */
export function decide(result, pulls) {
  if (!result.behind) {
    return { open: false, why: `${result.sdk} is not behind` };
  }
  const known = pulls.find((pull) => pull.title === result.title || pull.headRefName === result.branch);
  if (known) {
    return { open: false, why: `${result.title}: #${known.number} is already there (${known.state.toLowerCase()})` };
  }
  return { open: true };
}

/** The open pull requests of this script for an older release of the same SDK: they are replaced by the new one. */
export function superseded(result, pulls) {
  return pulls.filter(
    (pull) =>
      pull.state === 'OPEN' && pull.headRefName.startsWith(`pin-${result.sdk}-`) && pull.headRefName !== result.branch,
  );
}

/**
 * Opens a pull request for each SDK that is behind, unless there is one for that version already. `exec` runs what only reads, `act`
 * what writes (and says what it would, in a dry run), `files` reads and writes the working tree. `head` is where each branch starts.
 */
export function propose(entries, { exec, act, files, head }) {
  const pulls = JSON.parse(
    exec('gh', ['pr', 'list', '--state', 'all', '--limit', '100', '--json', 'number,title,state,headRefName']),
  );
  for (const { sdk, result } of entries) {
    const verdict = decide(result, pulls);
    if (!verdict.open) {
      console.log(verdict.why);
      continue;
    }
    act('git', ['switch', '--create', result.branch]);
    const written = bump(sdk, result.pinned, result.latest, files);
    act('git', ['add', '--', ...written]);
    act('git', [...BOT, 'commit', '--message', result.title, '--message', commitMessage(sdk, result)]);
    act('git', ['push', '--set-upstream', 'origin', result.branch]);
    // CI before the pull request, so that its description can link to the run
    const started = act('gh', ['workflow', 'run', 'ci.yaml', '--ref', result.branch]);
    const run = /https:\/\/github\.com\/\S+\/actions\/runs\/\d+/.exec(started)?.[0];
    const body = describePullRequest(sdk, result, written, run);
    const created = act('gh', [
      'pr',
      'create',
      '--base',
      BASE,
      '--head',
      result.branch,
      '--title',
      result.title,
      '--body',
      body,
    ]);
    const number = /\/pull\/(\d+)/.exec(created)?.[1];
    for (const old of superseded(result, pulls)) {
      act('gh', [
        'pr',
        'close',
        String(old.number),
        '--delete-branch',
        '--comment',
        `Replaced by ${number ? `#${number}` : result.title}.`,
      ]);
    }
    act('git', ['switch', '--detach', head]);
  }
}

async function fetchOk(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return response;
}

/** The latest stable release of an SDK, from wherever its `releases` say it is published. */
export async function latestRelease({ releases }, token) {
  switch (releases.kind) {
    case 'github': {
      const url = `https://api.github.com/repos/${releases.repo}/releases/latest`;
      const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      return versionOf((await (await fetchOk(url, headers)).json()).tag_name);
    }
    case 'maven':
      return latestStable(mavenVersions(await (await fetchOk(releases.metadata)).text()));
    case 'folders':
      return latestStable(folderVersions(await (await fetchOk(releases.listing)).json()));
    case 'file': {
      const version = releases.pin.exec(await (await fetchOk(releases.url)).text())?.[1];
      if (!version) {
        throw new Error(`${releases.url} names no version`);
      }
      return versionOf(version);
    }
    default:
      throw new Error(`unknown kind of release source: ${releases.kind}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--pr' && arg !== '--dry-run');
  if (unknown.length > 0 || (args.includes('--dry-run') && !args.includes('--pr'))) {
    throw new Error(`usage: check-pins.mjs [--pr [--dry-run]] (got ${args.join(' ') || 'nothing'})`);
  }
  const dry = args.includes('--dry-run');
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const entries = [];
  for (const sdk of SDKS) {
    const result = assess(sdk, readPin(sdk), await latestRelease(sdk, token));
    console.log(result.line);
    entries.push({ sdk, result });
  }
  if (args.includes('--pr')) {
    const exec = (command, argv) => execFileSync(command, argv, { cwd: root, encoding: 'utf8' });
    const quote = (arg) => (/^[\w./:=@+-]+$/.test(arg) ? arg : JSON.stringify(arg));
    const act = dry
      ? (command, argv) => {
          console.log(`would run: ${[command, ...argv].map(quote).join(' ')}`);
          return '';
        }
      : (command, argv) => {
          const output = exec(command, argv);
          process.stdout.write(output);
          return output;
        };
    const files = {
      read: readRoot,
      write: dry
        ? (file) => console.log(`would write: ${file}`)
        : (file, text) => writeFileSync(join(root, file), text),
    };
    propose(entries, { exec, act, files, head: exec('git', ['rev-parse', 'HEAD']).trim() });
  }
}
