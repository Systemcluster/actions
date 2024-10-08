import type { GetResponseTypeFromEndpointMethod } from '@octokit/types';
import type { GitHub } from 'actions-utils/context';
export type Octokit = InstanceType<GitHub>;
export interface Inputs {
    githubToken: string;
    repository: string;
    name: string;
    tag: string;
    prerelease: boolean;
    draft: boolean;
    files: string[];
    message?: string;
    messageFile?: string;
    messagePulls?: string;
    messageCommits?: string;
    compareTag: boolean;
    compareLatest: boolean;
    compareFirst: boolean;
    useGitHubReleaseNotes: boolean;
}
export type Release = GetResponseTypeFromEndpointMethod<Octokit['rest']['repos']['createRelease']>['data'];
export type CompareCommit = GetResponseTypeFromEndpointMethod<Octokit['rest']['repos']['compareCommits']>['data']['commits'][0];
export type Commit = GetResponseTypeFromEndpointMethod<Octokit['rest']['git']['getCommit']>['data'];
export type PullRequest = GetResponseTypeFromEndpointMethod<Octokit['rest']['pulls']['list']>['data'][0];
export type Ref = GetResponseTypeFromEndpointMethod<Octokit['rest']['git']['getRef']>['data'];
export interface Repository {
    owner: string;
    repo: string;
}
export declare const getInputs: () => Inputs;
export declare const getFiles: (files: string[]) => Promise<string[]>;
export declare const getCompareBase: (gh: Octokit, repository: Repository, inputs: Inputs) => Promise<{
    commit: Commit;
    release?: Release;
} | undefined>;
export declare const getReleaseBody: (gh: Octokit, repository: Repository, inputs: Inputs, target: string) => Promise<string>;
export declare const createRelease: (gh: Octokit, repository: Repository, inputs: Inputs, body: string, target: string) => Promise<Release>;
export declare const cleanUploadUrl: (uploadUrl: string) => string;
export declare const uploadAssets: (inputs: Inputs, release: Release, files: string[]) => Promise<Record<string, any>>;
export declare const main: (inputsOverride?: Inputs, push?: boolean) => Promise<void>;
