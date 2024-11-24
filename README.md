# Release GitHub Action

**Create or update a GitHub Release. 📦**

```yaml
- name: Create Release
  uses: Systemcluster/actions@release-github-v0
  with:
    name: Example Release
    tag: snapshot
    compare-first: true
    files: |
      README.md
      dist/**/*
      LICENSE
```

## Features

- **Automatically creates or updates a GitHub release**
- **Uploads release assets** from a list of files or glob patterns
- **Creates a tag** for the release if it does not exist
- **Automatically generates release notes** from pull requests and commits
- **Compares the release** with the latest release, the latest release of the same tag or the first commit in the branch when generating release notes
- **Allows customization** of the generated release notes based on pull requests and commits
- **Supports reading release notes** from a file for allowing use of other changelog generators
- **Allows using GitHub's release note generator** as an alternative

## Usage

### Inputs

| Name | Type | Description | Default | Required |
| --- | --- | --- | --- | --- |
| `github-token` | String | GitHub Access Token. | `{github.token}` | ✓ |
| `repository` | String | Repository to push the release to, in the format `owner/repo`. | `{github.repository}` | ✓ |
| `name` | String | Name of the release. | `{tag}` | ✗ |
| `tag` | String | Tag of the release | `{github.ref}` | ✗ |
| `prerelease` | Boolean | Whether the release will be marked as a prerelease. | `false` | ✗ |
| `draft` | Boolean | Whether the release will be marked as a draft. | `false` | ✗ |
| `files` | String | List of files or glob patterns to include in the release. | | ✓ |
| `message` | String | Message to prepend to the release notes. | | ✗ |
| `message-file` | String | Path to a file containing a message to prepend to the release notes. | | ✗ |
| `message-pulls` | String | Message to generate for pull requests included in the release. Supports placeholders for `{title}`, `{pull}`, `{user}` and `{author}`.' | | ✗ |
| `message-commits` | String | Message to generate for commits included in the release. Supports placeholders for `{message}`, `{hash}`, `{shorthash}`, `{user}`, `{author}`, `{body}` and `{pull}`. | `"- {shorthash}: {message} ({pull})\n{body}"` | ✗ |
| `compare-tag` | Boolean | Whether the release will be compared with the latest release of the same tag. | `true` | ✗ |
| `compare-latest` | Boolean | Whether the release will be compared with the latest release if not compared with the latest release of the same tag or no release with the same tag exists. | `true` | ✗ |
| `compare-first` | Boolean | Whether the release will be compared with the first commit in the branch if not compared with the latest release or no release exists. | `false` | ✗ |
| `use-github-release-notes` | Boolean | Whether to use GitHub's release note generator instead of the default generator. Disables `message-pulls` and `message-commits`. | `false` | ✗ |

### Outputs

| Name | Type | Description |
| --- | --- | --- |
| `id` | String | ID of the release. |
| `release-url` | String | URL of the release. |
| `upload-url` | String | URL for uploading assets to the release. |

### Permissions

This Action requires the following permissions:

```yaml
permissions:
  contents: write
  pull-requests: read
```

When pushing to a repository that is not the current repository, a `github-token` with the `contents: write` and `pull-requests: read` scope is required.
