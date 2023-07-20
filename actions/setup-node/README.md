# Setup Node Action

**Setup a Node.js environment with the right package manager and package caching. 🧰**

```yaml
- name: Set up Node.js
  uses: Systemcluster/actions@setup-node-v0
  with:
    node-version: lts
    package-manager: pnpm
    install: true
    update: true
    cache: true
```

## Features

- **Installs Node.js** detecting the desired version by reading the `NODE_VERSION` environment variable, `.nvmrc` and `.node-version` files, and the `engines.node` field in `package.json`
- **Installs the right package manager** by checking for existing lock files and the `packageManager` field in `package.json`
- **Installs dependencies** using the installed package manager
- **Caches the package manager store** to speed up dependency installation
- **Adds problem matchers** for `eslint` and `tsc`

## Usage

### Inputs

| Name | Type | Description | Default | Required |
| --- | --- | --- | --- | --- |
| `node-version` | String | Version of Node.js to install. Can be a specific version like `18.x`, `16.20.x` or a version tag like `lts` or `latest`. | Read from the `NODE_VERSION` environment variable, `.nvmrc` and `.node-version` files, the `engines.node` field in `package.json`, and falling back to `lts`. | ✗ |
| `package-manager` | String | Package manager to install. Can be a name like `pnpm` or a name and version like `npm@9`. | Read from the `packageManager` field in `package.json` if present, detected from a lockfile if available, and falling back to `npm`. | ✗ |
| `directory` | String | Directory containing the Node project. Used for detecting node version and package manager configuration. | `.` | ✗ |
| `install` | Boolean | Whether to install Node project dependencies. | `false` | ✗ |
| `cache` | Boolean | Whether to cache and restore the Node package manager store. | `true` | ✗ |
| `cache-key-job` | Boolean | Whether to consider the Job ID when generating the cache key. Set to `true` to prevent sharing the cache across jobs. Requires `cache` to be `true`. | `false` | ✗ |
| `cache-key-env` | String[] | List of environment variables to consider when generating the cache key. Requires `cache` to be `true`. | | ✗ |

### Outputs

| Name | Type | Description |
| --- | --- | --- |
| `node-version` | String | Version of Node.js that was installed. |
| `package-manager` | String | Name of the package manager that was installed. |
| `cache-hit` | Boolean | Whether the Node package manager store cache was restored. |

Additionally, the `PATH` environment variable is updated to include the Node.js installation directory, and the `NODE_VERSION` environment variable is set to the installed Node.js version.

## Details

### Node.js version

The desired Node.js version is detected in the following order:

1. Using the `node-version` input if specified
2. Read from the `NODE_VERSION` environment variable if present
3. Read from a `.nvmrc` file if present in `directory` or any parent directory
4. Read from a `.node-version` file if present in `directory` or any parent directory
5. Read from the `engines.node` field in if present in the `package.json` in `directory` or any parent directory
6. Falling back to `lts`

The detected version is then resolved to a specific version using [node-version-alias](https://www.npmjs.com/package/node-version-alias).

### Package manager

The desired package manager is detected in the following order:

1. Using the `package-manager` input if specified
2. Read from the `packageManager` field in the `package.json` in `directory` if present
3. Inferred from a lockfile if present in `directory` or any parent directory
4. Read from the `packageManager` field if present in the `package.json` in any parent directory
5. Falling back to `npm`

Lockfiles checked for inferring the package manager include `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, and `pnpm-lock.yaml`.

### Cache

When the `cache` input is `true`, the package manager store is cached and restored using [actions/cache](https://github.com/actions/cache).

The package manager store is resolved via the following commands:

- `npm config get cache` for `npm`
- `pnpm store path` for `pnpm`
- `yarn cache dir` for `yarn@1`
- `yarn config get cache-folder` for `yarn@>1`

The cache key is generated based on the following inputs:

- The `dependencies`, `devDependencies` and `peerDependencies` fields in the `package.json` in `directory` and all subdirectories
- The package manager-specific lockfiles in `directory` and all subdirectories
- The `GITHUB_JOB` environment variable if `cache-key-job` is `true`
- The environment variables specified in `cache-key-env`
- The `os.platform()` and `os.arch()` of the runner

In case of a cache key miss, a cache matching the `os.platform()` and `os.arch()` of the runner is restored.

The package manager cache is always pruned before the cache is saved.
