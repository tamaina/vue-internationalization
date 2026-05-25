## Unreleased

### Changes

- fix: Preserve Vue `<script setup generic="...">` attributes when injecting setup bindings.
- fix: Emit inline locale chunks through the plugin context for Rolldown compatibility.
- fix: Allow configured global locale files to live outside the package-local tsconfig directory.
- feat: Add Volar `globalType: "runtime"` for large global dictionaries.
- fix: Keep `globalType: "runtime"` permissive for nested global dictionary access.
- fix: Avoid injecting component `$locale`/`$l` options for global-only `sfcTransform: "all"` SFCs.
- fix: Make Vue SFC binding injection idempotent when a transform pipeline sees an already-injected file.
- fix: Avoid redeclaring `$locale`/`$l` when a Vue SFC already imports or declares those bindings.
- fix: Avoid setup-binding injection for inline global-only SFC transforms.
- fix: Replace inline marker calls whose marker arguments are emitted as template literals.
- fix: Replace inline marker calls nested in localizer values expressions.
- fix: Rewrite inline locale access across top-level SFC templates that contain nested template slots.
- fix: Preserve method calls chained after inline locale text access.


## 0.6.0

### Changes

- fix: Avoid duplicating detailed global `env` dictionary types into every Vite-transformed SFC.


## 0.5.0

### Changes

- feat: Add `sfcTransform: "all"` to inject `$locale` and `$l` into every Vue SFC for global dictionary access without local locale sources.
- fix: Include `README.md` in the published package files.


## 0.4.1

### Changes

- fix: fix repository url for npm publish


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
