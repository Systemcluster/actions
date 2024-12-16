import { type SemverVersion } from 'node-version-alias';
export interface Inputs {
    nodeVersion: string;
    packageManager: string;
    directory: string;
    install: boolean;
    cache: boolean;
    cacheKeyJob: boolean;
    cacheKeyEnv: string[];
}
export declare const getInputs: () => Inputs;
export declare const getExecutable: (name: string) => string;
export declare const parseNodeVersion: (nodeVersion: string) => Promise<SemverVersion>;
type PackageManager = 'npm' | 'yarn' | 'pnpm';
export interface PackageManagerInfo {
    name: PackageManager;
    version: string;
}
export declare const parsePackageManager: (packageManager: string) => PackageManagerInfo;
export interface PackageJson {
    directory: string;
    nodeVersion?: string;
    packageManager?: PackageManager;
    packageManagerVersion?: string;
}
export declare const findPackageJson: (directory: string, parents?: boolean) => Promise<PackageJson | null>;
export interface LockFile {
    directory: string;
    file: string;
    packageManager: PackageManager;
}
export declare const findLockFile: (directory: string, parents?: boolean) => Promise<LockFile | null>;
export interface VersionFile {
    name: string;
    directory: string;
    version: string;
}
export declare const findVersionFile: (directory: string, parents?: boolean) => Promise<VersionFile | null>;
export interface CacheTarget {
    directories: string[];
    cacheFiles: string[];
}
export declare const findCacheTarget: (projectDirectory: string, packageManager: PackageManager) => Promise<CacheTarget>;
export declare const installNode: (version: SemverVersion) => Promise<string>;
export declare const installPackageManager: (nodePath: string, packageManager: PackageManagerInfo) => Promise<string>;
export declare const installDependencies: (directory: string, packageManager: PackageManager) => Promise<void>;
export interface CacheKey {
    exact: string;
    partial: string[];
}
export declare const getCacheKey: (projectDirectory: string, cacheFiles: string[], inputs: Inputs) => Promise<CacheKey>;
export declare const restorePackageManagerCache: (directories: string[], cacheKey: CacheKey) => Promise<string | undefined>;
export declare const savePackageManagerCache: (directories: string[], cacheKey: string) => Promise<number>;
export declare const prunePackageManagerCache: (directory: string, packageManager: PackageManager) => Promise<void>;
export declare const main: (inputsOverride?: Inputs, install?: boolean) => Promise<void>;
export declare const post: () => Promise<void>;
export {};
