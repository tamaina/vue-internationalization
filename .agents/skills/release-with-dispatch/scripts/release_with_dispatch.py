#!/usr/bin/env python3
"""Guarded dispatcher for this repository's release-with-dispatch workflow."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


WORKFLOW = "release-with-dispatch.yml"
VERSION_INCREMENT_TYPES = ("auto", "major", "minor", "patch")


def run(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=check, text=True, capture_output=True)


def print_cmd(args: list[str]) -> None:
    print("+ " + " ".join(quote(arg) for arg in args))


def quote(value: str) -> str:
    if all(ch.isalnum() or ch in "._/-:=@" for ch in value):
        return value
    return "'" + value.replace("'", "'\\''") + "'"


def gh_json(args: list[str]) -> object:
    completed = run(["gh", *args])
    return json.loads(completed.stdout)


def gh_text(args: list[str], *, optional: bool = False) -> str:
    completed = run(["gh", *args], check=not optional)
    if optional and completed.returncode != 0:
        return ""
    return completed.stdout.strip()


def git_text(args: list[str], *, optional: bool = False) -> str:
    completed = run(["git", *args], check=not optional)
    if optional and completed.returncode != 0:
        return ""
    return completed.stdout.strip()


def infer_version_increment(default_branch: str, stable_branch: str) -> tuple[str, list[str]]:
    git_text(["fetch", "origin", default_branch, stable_branch, "--tags"], optional=True)
    range_spec = f"origin/{stable_branch}..origin/{default_branch}"
    subjects = git_text(["log", "--pretty=%s", range_spec], optional=True).splitlines()
    relevant_subjects = [
        subject for subject in subjects
        if not subject.startswith("[skip ci]") and not subject.startswith("Bump version to ")
    ]

    if any(is_minor_subject(subject) for subject in relevant_subjects):
        return "minor", relevant_subjects

    return "patch", relevant_subjects


def is_minor_subject(subject: str) -> bool:
    normalized = subject.lower()
    return normalized.startswith("feat:") or normalized.startswith("feat(") or normalized.startswith("feature:")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version-increment-type", choices=VERSION_INCREMENT_TYPES, default="auto")
    parser.add_argument("--merge", action="store_true", help="Merge/finalize an existing release PR.")
    parser.add_argument("--start-rc", action="store_true", help="Start an rc prerelease channel.")
    parser.add_argument("--execute", action="store_true", help="Actually dispatch the workflow.")
    parser.add_argument("--workflow", default=WORKFLOW)
    args = parser.parse_args()

    workflow_path = Path(".github/workflows") / args.workflow
    if not workflow_path.exists():
        print(f"error: {workflow_path} not found; run from the repository root", file=sys.stderr)
        return 2

    try:
        run(["gh", "auth", "status"])
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        print(f"error: gh is unavailable or unauthenticated: {exc}", file=sys.stderr)
        return 2

    status = gh_text(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"])
    repo = json.loads(status)
    repo_name = repo["nameWithOwner"]
    default_branch = repo["defaultBranchRef"]["name"]

    stable_branch = gh_text(["variable", "get", "STABLE_BRANCH"], optional=True)
    release_prs: object = []
    if stable_branch:
        release_prs = gh_json([
            "pr",
            "list",
            "--limit",
            "1",
            "--search",
            f"head:{default_branch} base:{stable_branch} is:open",
            "--json",
            "number,title,headRefName,baseRefName,isDraft",
        ])

    print(f"repo: {repo_name}")
    print(f"default_branch: {default_branch}")
    print(f"stable_branch: {stable_branch or '(missing STABLE_BRANCH variable)'}")
    print(f"existing_release_pr: {json.dumps(release_prs, ensure_ascii=False)}")

    version_increment_type = args.version_increment_type
    if version_increment_type == "auto":
        if release_prs or not stable_branch:
            version_increment_type = "patch"
        else:
            version_increment_type, subjects = infer_version_increment(default_branch, stable_branch)
            print(f"inferred_version_increment_type: {version_increment_type}")
            print("release_subjects:")
            for subject in subjects:
                print(f"- {subject}")

    dispatch_cmd = [
        "gh",
        "workflow",
        "run",
        args.workflow,
        "-f",
        f"version_increment_type={version_increment_type}",
        "-f",
        f"merge={str(args.merge).lower()}",
        "-f",
        f"start-rc={str(args.start_rc).lower()}",
    ]

    print_cmd(dispatch_cmd)
    if not args.execute:
        print("dry-run: add --execute to dispatch")
        return 0

    run(dispatch_cmd)
    print("dispatch submitted")
    runs = gh_text([
        "run",
        "list",
        "--workflow",
        args.workflow,
        "--limit",
        "1",
        "--json",
        "databaseId,url,status,conclusion,createdAt",
    ], optional=True)
    if runs:
        print(runs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
