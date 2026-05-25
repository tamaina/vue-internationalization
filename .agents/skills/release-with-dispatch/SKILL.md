---
name: release-with-dispatch
description: Run or prepare the GitHub Actions workflow_dispatch release flow for tamaina/vite-vue-internationalization. Use when the user asks an agent to automate release-with-dispatch, start an alpha/beta/rc prerelease, create a release PR, or merge/finalize a release through the repository's Release Manager [Dispatch] workflow.
---

# Release With Dispatch

## Overview

Automate this repository's `.github/workflows/release-with-dispatch.yml` workflow with explicit preflight checks and guarded dispatch. Prefer the bundled script for repeatable argument handling.

## Release Lifecycle

Treat the workflow as a state machine around the release PR from the development branch to the stable branch.

1. No release PR exists:
   - Dispatch with `merge=false` and `start-rc=false`.
   - The workflow runs `create-target`.
   - It creates the next release target from the current package version using `version_increment_type`.
   - Decide `minor` or `patch` from unreleased commits unless the user explicitly specifies an increment.
   - Use `minor` when unreleased commits include user-facing features such as `feat:` commits or documented new public API/configuration.
   - Use `patch` when unreleased commits are fixes, refactors, perf improvements, docs, tests, chores, or internal tooling without new public capability.
   - Use `major` only when the user explicitly asks for it or the release notes clearly describe breaking changes and the user confirms.
   - The expected result is a draft prerelease/release PR from the repository default branch to `STABLE_BRANCH`.
2. Release PR exists and is still in draft/early prerelease:
   - Dispatch with `merge=false` and `start-rc=false`.
   - The workflow runs `create-prerelease`.
   - It creates or advances the prerelease channel managed by release-manager-actions.
   - In this repo config, draft prerelease starts at `alpha`, and ready prerelease uses `beta`.
3. The user asks to start an RC:
   - Dispatch with `merge=false` and `start-rc=true`.
   - The workflow runs `create-prerelease` with `prerelease_channel=rc`.
   - It changes the active prerelease channel to `rc` and resets numbering on channel change.
4. The user marks the release PR ready for review:
   - Do not dispatch manually unless requested.
   - `.github/workflows/release-with-ready.yml` can automatically run `create-prerelease` when the PR head is the default branch and the base is `STABLE_BRANCH`.
   - Interpret this as the beta lifecycle transition.
5. The user asks to finalize or merge the release:
   - Dispatch with `merge=true`.
   - The workflow runs `merge`.
   - It merges the release PR into `STABLE_BRANCH`, rewrites configured package JSON files, and refreshes the unreleased changes template.

## Rollback

When the user asks to roll back a release target before final merge:

1. Close the open release PR with `gh pr close <number> --comment "<reason>"`.
2. Delete the prerelease and tag created for the abandoned target when they exist, for example `gh release delete <version>-alpha.0 --cleanup-tag --yes`.
3. Restore the development branch release workspace:
   - Change the top `CHANGELOG.md` heading back from `## <version>` to `## Unreleased`.
   - Restore `package.json` to the latest stable package version if it was bumped to a prerelease version.
4. Commit and push the rollback before dispatching a replacement release target.
5. Re-check that no open release PR remains before running `create-target` again.

## Workflow

1. Confirm the workspace is `tamaina/vite-vue-internationalization` or ask before applying this skill elsewhere.
2. Inspect `.github/workflows/release-with-dispatch.yml` before dispatch if it changed recently.
3. Check `git status --short`. Do not edit release files or build artifacts as part of this skill unless the user asks.
4. Check GitHub access with `gh auth status` and identify the repo with `gh repo view --json nameWithOwner,defaultBranchRef`.
5. Determine release state:
   - Get `STABLE_BRANCH` with `gh variable get STABLE_BRANCH`.
   - List the existing release PR with `gh pr list --limit 1 --search "head:<default-branch> base:<stable-branch> is:open" --json number,title,headRefName,baseRefName,isDraft`.
6. If no release PR exists, decide the version increment:
   - Compare unreleased work with `git fetch origin <default-branch> <stable-branch> --tags` and `git log --oneline origin/<stable-branch>..origin/<default-branch>`.
   - Prefer `minor` if there is a `feat:` commit or a clear new public option/API documented in README/docs/llms.
   - Prefer `patch` if the range is only `fix:`, `perf:`, `refactor:`, `docs:`, `test:`, `chore:`, release tooling, or generated release commits.
   - Do not silently choose `major`; stop and ask unless the user already requested it.
7. Before dispatching a release target, inspect `README.md` against unreleased user-facing changes. Add or request missing README coverage for new public behavior, options, build output, or usage constraints before releasing.
8. Choose dispatch inputs from the lifecycle above.
9. If the user explicitly requested the release action, dispatch it. If the user only asked to inspect, plan, or "see if possible", dry-run and report the exact command.
10. After dispatch, provide the workflow run URL from `gh run list --workflow release-with-dispatch.yml --limit 1 --json databaseId,url,status,conclusion,createdAt`.
11. When a release PR is marked ready for review and the user did not give a different instruction, perform a PR review before moving on to final merge or release dispatch. Check the release diff, README coverage, package version, changelog content, and generated release artifacts.

## Script

Use from the repository root:

```bash
python3 .agents/skills/release-with-dispatch/scripts/release_with_dispatch.py
```

The script defaults to dry-run. Add `--execute` only when the user clearly asked to perform the release action.

Common examples:

```bash
# Inspect release state, choose minor/patch, and print the dispatch command.
python3 .agents/skills/release-with-dispatch/scripts/release_with_dispatch.py

# Actually dispatch using the inferred minor/patch increment.
python3 .agents/skills/release-with-dispatch/scripts/release_with_dispatch.py --execute

# Override the inferred increment.
python3 .agents/skills/release-with-dispatch/scripts/release_with_dispatch.py --version-increment-type minor --execute

# Start an RC for an existing release PR.
python3 .agents/skills/release-with-dispatch/scripts/release_with_dispatch.py --start-rc --execute

# Merge/finalize an existing release PR.
python3 .agents/skills/release-with-dispatch/scripts/release_with_dispatch.py --merge --execute
```

## Guardrails

- Do not use `--merge` unless the user explicitly requests final merge or release finalization.
- Do not set `--start-rc` for ordinary alpha/beta prerelease advancement unless the user asks for RC.
- Do not assume `major`; choose only `minor` or `patch` automatically.
- Do not expose or print release app secrets.
- If `gh` is unavailable, unauthenticated, or lacks workflow dispatch permission, stop after reporting the failing preflight.
