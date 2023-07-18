# Release Crates Action

**Publish a Rust package or workspace on crates.io. 📦**

```yaml
- name: Release Crates
  uses: Systemcluster/actions@release-crates-v0
  with:
    crates-token: ${{ secrets.CRATES_TOKEN }}
    directory: rust-workspace
    tag-crate: serde
```

## Features

- **Releases a crate or all crates in a workspace** to [crates.io](https://crates.io)
- **Checks existing releases** on crates.io before releasing and skips releases of versions that are already published
- **Checks the validity** of crates and workspace
- **Publishes crates in the correct order** when releasing multiple crates based on their dependency on each other
- **Optionally creates a tag** in the GitHub repository for the release of a specified crate

## Usage

### Inputs

| Name | Type | Description | Default | Required |
| --- | --- | --- | --- | --- |
| `github-token` | String | GitHub Access Token. | `{github.token}` | ✓ |
| `crates-token` | String | Crates.io Access Token. |  | ✓ |
| `tag-crate` | String | Name of the crate for which to create a version tag in the GitHub repository. | | ✗ |
| `directory` | String | Directory containing the cargo package or workspace. | `.` | ✗ |
| `dry-run` | Boolean | Whether to skip publishing changes. | `false` | ✗ |
| `arguments` | String | Extra arguments for cargo publish. |  | ✗ |
| `only-newest` | Boolean | Whether to only publish crates when no newer version exists. | `false` | ✗ |

### Outputs

| Name | Type | Description |
| --- | --- | --- |
| `published` | String | JSON array containing the names of crates that were published. |
| `tag` | String | Tag created in the GitHub repository. |

### Permissions

This Action requires the following permissions when `tag-crate` is set:

```yaml
permissions:
  contents: write
```
