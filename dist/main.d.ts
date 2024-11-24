import semver from 'semver';
export interface Inputs {
    githubToken: string;
    cratesToken: string;
    tagCrate: string;
    directory: string;
    dryRun: boolean;
    allowDirty: boolean;
    arguments: string;
    onlyNewest: boolean;
}
export declare const getInputs: () => Inputs;
export declare const stringify: (value: unknown, indent?: number) => string;
export interface Dependency {
    name: string;
    kind: string | null;
    req: string;
    path?: string;
}
export interface Manifest {
    name?: string;
    manifest_path: string;
    version?: string;
    publish?: string[];
    dependencies?: Dependency[];
}
export interface Metadata {
    packages?: Manifest[];
    workspace_root?: string;
}
export interface Crate {
    path: string;
    name: string;
    version_string: string;
    version: semver.SemVer;
    publish: boolean;
    files: Set<string>;
    dependencies: Map<string, Dependency>;
}
export interface Workspace {
    path: string;
    crates: Map<string, Crate>;
}
export declare const getPackages: (directory: string) => Promise<Workspace>;
export declare const sortPackages: (workspace: Workspace) => string[];
export interface CrateVersionInfo {
    num: string;
    updated_at: string;
}
export interface CrateInfo {
    crate: {
        id: string;
        name: string;
        created_at: string;
        updated_at: string;
        max_version: string;
        newest_version: string;
    };
    versions: CrateVersionInfo[];
}
export declare const getPublishedCrate: (crate: Crate) => Promise<CrateInfo | null>;
export declare const awaitPublishedCrate: (crate: Crate, timeout?: number) => Promise<CrateInfo>;
export declare const publishCrate: (crate: Crate, inputs: Inputs, root: string, env: Record<string, string>, push: boolean) => Promise<boolean>;
export declare const checkCargo: () => Promise<boolean>;
export declare const main: (inputsOverride?: Inputs, push?: boolean) => Promise<void>;
