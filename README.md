# Setup Rust Action

**Setup a Rust environment with the right toolchain and build caching. 🧰**

```yaml
- name: Set up Rust
  uses: Systemcluster/actions@setup-rust-v0
  with:
    channel: stable
    components: rustfmt,clippy
    targets: wasm32-unknown-unknown,x86_64-unknown-linux-gnu
    binaries:
      - cargo-nextest
      - cargo-insta
    sccache: true
```

## Features

- **Installs Rust** detecting the desired toolchain by reading the `RUSTUP_TOOLCHAIN` environment variable, `rust-toolchain.toml` and `rust-toolchain` files, or by manual specification
- **Caches the Cargo registry and build artifacts** to speed up build and dependency installation
- **Installs sccache** and sets up GitHub Actions integration
- **Adds problem matchers** for `rustc`, `rustfmt` and runtime panics

## Usage

### Inputs

| Name | Type | Description | Default | Required |
| --- | --- | --- | --- | --- |
| `channel` | String | Version of Rust to install. Can be a channel like `stable`, `beta`, `nightly`, or a specific version like `1.54.0` or `nightly-2021-08-01`. | Read from the `RUSTUP_TOOLCHAIN` environment variable, `rust-toolchain` or `rust-toolchain.toml` file, and falling back to `stable`. | ✗ |
| `components` | String[] | List of components to install. Can be a list of component names like `rustfmt`, `clippy`, or `rust-src`. | Read from the `rust-toolchain.toml` file. | ✗ |
| `targets` | String[] | List of targets to install. Can be a list of target names like `wasm32-unknown-unknown`, `x86_64-unknown-linux-gnu`, or `x86_64-apple-darwin`. | Read from the `rust-toolchain.toml` file. | ✗ |
| `profile` | String | Profile to install. Can be `minimal`, `default`, or `complete`. | Read from the `rust-toolchain.toml` file and falling back to `minimal`. | ✗ |
| `binaries` | String[] | List of binaries to install. Can be a list of binary names like `cargo-nextest` or specific versions like `cargo-insta@1.32.0`. | | ✗ |
| `directory` | String | Directory containing the Rust project. Used for detecting Rust version and configuration and for caching build artifacts. | `.` | ✗ |
| `sccache` | Boolean | Whether to set up [`sccache`](github.com/mozilla/sccache/) with GitHub Actions integration. | `true` | ✗ |
| `cache` | Boolean | Whether to cache and restore the Cargo registry and the build artifacts in the target directory. | `true` | ✗ |
| `cache-profile` | String | The build profile to cache. Can be `debug`, `release`, or any custom profile. If not specified, all profiles are cached. Requires `cache` to be `true`. | | ✗ |
| `cache-sweep` | Boolean | Whether to run `cargo sweep` before saving the cache. Requires `cache` to be `true`. | `false` | ✗ |
| `cache-key-job` | Boolean | Whether to consider the Job ID when generating the cache key. Set to `true` to prevent sharing the cache across jobs. Requires `cache` to be `true`. | `false` | ✗ |
| `cache-key-env` | String[] | List of environment variables to consider when generating the cache key. Requires `cache` to be `true`. | | ✗ |

### Outputs

| Name | Type | Description |
| --- | --- | --- |
| `rust-version` | String | Version of Rust that was installed. |
| `rust-version-hash` | String | Commit hash of the Rust version that was installed. |
| `cache-hit` | Boolean | Whether the Cargo registry and build artifact cache was restored. |

## Details

### Rust toolchain

#### Toolchain channel

The desired Rust toolchain channel is detected in the following order:

1. Using the `channel` input if specified
2. Read from the `RUSTUP_TOOLCHAIN` environment variable if present
3. Read from a `rust-toolchain.toml` if present in `directory`
4. Read from a `rust-toolchain` file if present in `directory`
5. Falling back to `stable`

The chosen toolchain is installed with `rustup` and set as the default toolchain.

#### Toolchain components, targets, and profile

The desired toolchain components, targets, and profile are detected in the following order:

1. Using the `components`, `targets`, and `profile` inputs if specified
2. Read from the `rust-toolchain.toml` file if present in `directory`
3. Falling back to the `minimal` profile and no components or targets

Both `targets` and `components` can alternatively be specified as a single string with values separated by `,` or `;`, for example `x86_64-unknown-linux-gnu;wasm32-unknown-unknown` or `rustfmt,clippy`.

If `targets` and `components` are specified in multiple places, the lists are merged.

### Binaries

Binaries are installed with [`cargo-binstall`](https://crates.io/crates/cargo-binstall). `cargo-cache` and `cargo-sweep` are installed by default when `cache` is `true`.

If `binaries` is empty and both `cache` and `sccache` are `false`, the installation of `cargo-binstall` is skipped.

### Caching

When the `cache` input is `true`, the Cargo store and build artifacts are cached and restored using [actions/cache](https://github.com/actions/cache).

The cache key is generated based on the following inputs:

- The `Cargo.lock` files in `directory` and all subdirectories
- The `dependencies` and `workspace.dependencies` fields in `Cargo.toml` files in `directory` and all subdirectories
- The `GITHUB_JOB` environment variable if `cache-key-job` is `true`
- The environment variables specified in `cache-key-env`
- The `os.platform()` and `os.arch()` of the runner

In case of a cache key miss, a cache matching the `os.platform()` and `os.arch()` of the runner is restored.

The following directories are cached:

- The Cargo registry (`~/.cargo/registry`)
  - Before caching, the registry is cleaned with [`cargo cache --autoclean`](https://crates.io/crates/cargo-cache) and any `.cache` directories are removed
- The build artifacts (`target`)
  - Before caching, the target directory is cleaned with [`cargo sweep --installed`](https://crates.io/crates/cargo-sweep) if `cache-sweep` is `true`, and the `examples` and `incremental` directories as well as all dep-info files (`*.d`) are removed
  - If `cache-profile` is specified, all other profile directories are removed

### Sccache

When the `sccache` input is `true`, [`sccache`](https://crates.io/crates/sccache) is installed and set up with [GitHub Actions integration](https://github.com/mozilla/sccache/blob/HEAD/docs/GHA.md) by setting the following environment variables:

- `ACTIONS_CACHE_URL` is set to the cache URL provided to the action
- `ACTIONS_RUNTIME_TOKEN` is set to the token provided to the action
- `SCCACHE_PATH` is set to the path to the `sccache` binary
- `SCCACHE_GHA_ENABLED` is set to `true`
- `RUSTC_WRAPPER` is set to `sccache`
