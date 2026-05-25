## Unreleased

### Changes

-


## 0.8.0

### Changes

- feat: Preserve CSP-related HTML script attributes when rewriting inline locale chunk entries.
- feat: Replace inline locale loader SRI and verify locale chunks with modulepreload integrity metadata.
- fix: Harden locale dictionary parsing and merging with null-prototype dictionaries and unsafe key rejection.
- docs: Document inline chunk CSP, SRI, dynamic lookup, and fallback behavior in README and build strategy docs.
- chore: Update the release dispatch skill to require README coverage checks and post-ready release PR review.


## 0.7.0

### Changes

- fix: Preserve Vue `<script setup generic="...">` attributes when injecting setup bindings.
- fix: Emit inline locale chunks through the plugin context for Rolldown compatibility.
- fix: Restore inline localized entries in Vite manifest files when Rolldown emits CSS-only entry records.
- fix: Rewrite inline chunk references embedded in Vite preload dependency lists.
- fix: Localize chunks that only reference other localized chunks in inline builds.
- fix: Localize every known inline chunk filename reference through the inline resolver.
- fix: Replace Vite preload placeholders in emitted inline locale chunks with localized dependency lists.
- refactor: Centralize inline chunk reference localization through one resolver.
- fix: Avoid preserving CSS-only preload proxy chunks as runtime imports in inline builds.
- fix: Preserve static and dynamic import metadata when augmenting Vite manifests for inline builds.
- fix: Inject inline locale loaders for Vite HTML entry builds that remove the original entry script.
- fix: Respect Vite `base` when rewriting or injecting inline locale HTML loaders.
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
- feat: Inline static and finite dynamic computed `$locale` template access for inline chunks.
- perf: Cache inline chunk locale payloads and reuse planned marker replacements across locales.
- chore: Make the release dispatch skill infer patch or minor increments from unreleased commits.


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
