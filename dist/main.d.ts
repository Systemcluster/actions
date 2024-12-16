import { type CommitObject } from 'isomorphic-git';
export interface Inputs {
    githubToken: string;
    repository: string;
    branch: string;
    tag: string;
    squash: boolean;
    gitignore: boolean;
    message: string;
    directory: string;
    include: string[];
    exclude: string[];
    clean: string[];
    impersonate: boolean;
}
export declare const getInputs: () => Inputs;
export declare const getFiles: (directory: string, include: string[], exclude: string[]) => Promise<string[]>;
export declare const getMessage: (template: string, commit: CommitObject) => string;
export declare const getCommit: (directory: string, ref?: string) => Promise<CommitObject>;
export declare const squash: (directory: string, reference: string) => Promise<void>;
export interface ReleaseResult {
    branch: string;
    tag?: string;
    commit: string;
    url: string;
    files: string[];
    changed: string[];
}
export declare const main: (inputsOverride?: Inputs, push?: boolean) => Promise<ReleaseResult>;
