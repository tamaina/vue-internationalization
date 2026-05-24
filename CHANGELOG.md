## Unreleased

### Changes

-


## 0.4.0

### Changes

-


## 0.3.0

### Changes

- enhance: Add inline-chunks replacement for static access to locale-only SFC imports such as `Messages.$locale.title` and `Messages.$l.body()`.
- fix: Keep normal component SFC imports, including SFCs with `<script setup>` or templates, out of the static replacement path so component imports and side effects are preserved.
- docs: Add example coverage for both locale-only SFC static access and normal component SFC static access.
- docs: Include `docs/api.md`, `docs/en/**/*.md`, and `llms.txt` in the published package.
- docs: Add `llms.txt` with usage guidance for AI coding assistants.
- chore: Pin the package manager to `pnpm@11.3.0`.
- chore: Add Release Manager workflows and initialize the `develop` release branch workflow.
- chore: Update the Docs GitHub Actions workflow to use Node.js 24.16.0.
