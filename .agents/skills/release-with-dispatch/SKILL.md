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
   - Default to `patch` unless the user explicitly asks for `minor` or `major`.
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

## Workflow

1. Confirm the workspace is `tamaina/vite-vue-internationalization` or ask before applying this skill elsewhere.
2. Inspect `.github/workflows/release-with-dispatch.yml` before dispatch if it changed recently.
3. Check `git status --short`. Do not edit release files or build artifacts as part of this skill unless the user asks.
4. Check GitHub access with `gh auth status` and identify the repo with `gh repo view --json nameWithOwner,defaultBranchRef`.
5. Determine release state:
   - Get `STABLE_BRANCH` with `gh variable get STABLE_BRANCH`.
   - List the existing release PR with `gh pr list --limit 1 --search "head:<default-branch> base:<stable-branch> is:open" --json number,title,headRefName,baseRefName,isDraft`.
6. Choose dispatch inputs from the lifecycle above.
7. If the user explicitly requested the release action, dispatch it. If the user only asked to inspect, plan, or "see if possible", dry-run and report the exact command.
8. After dispatch, provide the workflow run URL from `gh run list --workflow release-with-dispatch.yml --limit 1 --json databaseId,url,status,conclusion,createdAt`.

## Script

Use from the repository root:

```bash
python3 .agents/skills/release-with-dispatch/scripts/release_with_dispatch.py
```

The script defaults to dry-run. Add `--execute` only when the user clearly asked to perform the release action.

Common examples:

```bash
# Inspect and print the dispatch command for a patch release PR.
python3 .agents/skills/release-with-dispatch/scripts/release_with_dispatch.py

# Actually dispatch the default patch flow.
python3 .agents/skills/release-with-dispatch/scripts/release_with_dispatch.py --execute

# Dispatch a minor release target.
python3 .agents/skills/release-with-dispatch/scripts/release_with_dispatch.py --version-increment-type minor --execute

# Start an RC for an existing release PR.
python3 .agents/skills/release-with-dispatch/scripts/release_with_dispatch.py --start-rc --execute

# Merge/finalize an existing release PR.
python3 .agents/skills/release-with-dispatch/scripts/release_with_dispatch.py --merge --execute
```

## Guardrails

- Do not use `--merge` unless the user explicitly requests final merge or release finalization.
- Do not set `--start-rc` for ordinary alpha/beta prerelease advancement unless the user asks for RC.
- Do not assume `major` or `minor`; default to `patch` for new target releases.
- Do not expose or print release app secrets.
- If `gh` is unavailable, unauthenticated, or lacks workflow dispatch permission, stop after reporting the failing preflight.
