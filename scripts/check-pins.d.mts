// Types of scripts/check-pins.mjs, for the tests that import it.
export interface Follower {
  file: string;
  pin: RegExp;
  format?: (version: string) => string;
}
export type Releases =
  | { kind: 'github'; repo: string }
  | { kind: 'maven'; metadata: string }
  | { kind: 'folders'; listing: string }
  | { kind: 'file'; url: string; pin: RegExp };
export interface Sdk {
  name: string;
  releases: Releases;
  notes(version: string): string;
  file: string;
  pin: RegExp;
  followers: Follower[];
  mention: RegExp;
}
export interface Assessment {
  sdk: string;
  pinned: string;
  latest: string;
  behind: boolean;
  major: boolean;
  line: string;
  title: string;
  branch: string;
}
export interface PullRequest {
  number: number;
  title: string;
  state: string;
  headRefName: string;
}
export interface Files {
  read(file: string): string;
  write(file: string, text: string): void;
}
export const SDKS: Sdk[];
export function readPin(sdk: Pick<Sdk, 'name' | 'file' | 'pin'>, read?: (file: string) => string): string;
export function compareVersions(a: string, b: string): number;
export function versionOf(tag: string): string;
export function latestStable(versions: string[]): string;
export function mavenVersions(metadata: string): string[];
export function folderVersions(listing: { prefixes?: string[] }): string[];
export function assess(sdk: Sdk, pinned: string, latest: string): Assessment;
export function bump(sdk: Sdk, from: string, to: string, files: Files): string[];
export function commitMessage(sdk: Sdk, result: Assessment): string;
export function describePullRequest(sdk: Sdk, result: Assessment, files: string[], run?: string): string;
export function decide(result: Assessment, pulls: PullRequest[]): { open: boolean; why?: string };
export function superseded(result: Assessment, pulls: PullRequest[]): PullRequest[];
export function latestRelease(sdk: Sdk, token?: string): Promise<string>;
export function propose(
  entries: { sdk: Sdk; result: Assessment }[],
  io: {
    exec(command: string, args: string[]): string;
    act(command: string, args: string[]): string;
    files: Files;
    head: string;
  },
): void;
