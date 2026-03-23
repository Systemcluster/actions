# Release Branch Action

**Create or update GitHub branch with files from a subdirectory. 📦**

```yaml
- name: Update Release Branch
  uses: Systemcluster/actions@release-branch-v0
  with:
    branch: gh-pages
    tag: latest
    squash: true
    directory: dist
```

## Features

- **Automatically creates or updates a branch and tag** in a GitHub repository
- **Pushes files from a subdirectory** with support for including and excluding files based on glob patterns
- **Allows squashing** all previous commits in the target branch
- **Supports respecting the `.gitignore`** in the target branch
- **Supports committing as the committer** of the last commit in the source branch
- **Cleans the target branch** before adding files based on a list of files or glob patterns

## Usage

### Inputs

| Name | Type | Description | Default | Required |
| --- | --- | --- | --- | --- |
| `github-token` | String | GitHub Access Token. | `{github.token}` | ✓ |
| `repository` | String | Repository to push the release to. | `{github.repository}` | ✓ |
| `branch` | String | Branch to push the release to. Will be created if it does not exist. | default branch | ✗ |
| `tag` | String | Tag to create or update for the release. | | ✗ |
| `squash` | Boolean | When `true`, discard all previous commits in the target branch. | `false` | ✗ |
| `gitignore` | Boolean | When `true`, respect the `.gitignore` in the target branch.  | `false` | ✗ |
| `message` | String | Commit message to use for the release. Supports placeholders for "{message}", "{hash}" and "{shorthash}". Defaults to "{message}\n{hash}". | `{message}\n{hash}` | ✗ |
| `directory` | String | Directory to push to the target branch. | `.` | ✗ |
| `exclude` | String | Pattern or patterns of files to exclude. | | ✗ |
| `include` | String | Pattern or patterns of files to include. | | ✗ |
| `clean` | Boolean | Pattern or patterns of files to delete from the target branch before adding changes. | | ✗ |
| `impersonate` | boolean | When `true`, commit the release as the user that committed the last changes to the source branch. | `false` | ✗ |

### Outputs

| Name | Type | Description |
| --- | --- | --- |
| `commit` | String | Commit hash of the release. |

### Permissions

This Action requires the following permissions:

```yaml
permissions:
  contents: write
```

When pushing to a repository that is not the current repository, a `github-token` with the `contents: write` scope is required.
