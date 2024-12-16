export interface Inputs {
    channel: string;
    components: string[];
    targets: string[];
    profile: string;
    binaries: string[];
    directory: string;
    sccache: boolean;
    cache: boolean;
    cacheProfile: string;
    cacheSweep: boolean;
    cacheKeyJob: boolean;
    cacheKeyEnv: string[];
    githubToken: string;
}
export declare const getInputs: () => Inputs;
export declare const stringify: (value: unknown, indent?: number) => string;
export interface Toolchain {
    channel: string;
    components: string[];
    targets: string[];
    profile: string;
}
export declare const parseToolchainFile: (filePath: string) => Promise<Partial<Toolchain>>;
export declare const getToolchain: (inputs: Inputs) => Promise<Toolchain>;
export declare const installToolchain: (toolchain: Toolchain) => Promise<void>;
export declare const installBinstall: (target: string) => Promise<void>;
export interface RustVersion {
    version: string;
    hash: string;
}
export declare const getRustVersion: () => Promise<RustVersion>;
export declare const installBinaries: (binaries: string[], githubToken: string) => Promise<void>;
export interface CacheKey {
    exact: string;
    partial: string[];
}
export declare const getCacheKey: (inputs: Inputs, projectDirectory: string, toolchain: Toolchain, version: RustVersion) => Promise<CacheKey>;
export declare const restoreCargoCache: (projectDirectory: string, cargoDirectory: string, cacheKey: CacheKey) => Promise<string | undefined>;
export declare const saveCargoCache: (projectDirectory: string, cargoDirectory: string, cacheKey: string) => Promise<number>;
export declare const pruneCargoCache: (cargoDirectory: string) => Promise<void>;
export declare const pruneTargetDirectory: (inputs: Inputs, projectDirectory: string) => Promise<void>;
export declare const main: (inputsOverride?: Inputs, install?: boolean) => Promise<void>;
export declare const post: () => Promise<void>;
