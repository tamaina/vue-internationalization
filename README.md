# vite-vue-internationalization

A typed internationalization plugin for Vite that lets Vue SFCs own their translations directly.

## Documentation

- [English documentation](./docs/en/index.md)
- [日本語ドキュメント](./docs/index.md)

It supports `<locale>` custom blocks, global dictionaries, Volar type completion, and optional locale-specific chunk output.

```vue
<template>
  <h1>{{ $locale.sfc.title }}</h1>
  <p>{{ $l.sfc.count({ n }) }}</p>
</template>

<script setup lang="ts">
const n = 3;
</script>

<locale locale="ja-JP" lang="yaml">
title: りんご
count: "{n} 個のりんご"
</locale>

<locale locale="en-US" lang="yaml">
title: Apple
count: "one apple | {n} apples"
</locale>
```

## Features

- Write translations as YAML or JSON in Vue SFC `<locale>` blocks.
- Get typed `$locale` and `$l` completions in templates and TypeScript.
- Read app-wide global dictionaries through the same API.
- Opt into injecting `$locale` and `$l` for every SFC when global dictionary access is needed outside locale-owning components.
- Choose between Vue I18n-compatible syntax (`vue`) and ICU message syntax (`icu`).
- Choose either the `virtual` or `inline-chunks` build strategy.
- Share the same configuration between the Vite plugin and Vue Language Tools / Volar.

## Minimal Setup

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { vueInternationalization } from 'vite-vue-internationalization';

export default defineConfig({
  plugins: [
    vueInternationalization(),
    vue(),
  ],
});
```

```json
// tsconfig.json
{
  "vueCompilerOptions": {
    "plugins": [
      {
        "name": "vite-vue-internationalization/volar",
        "primaryLocale": "ja-JP"
      }
    ]
  }
}
```

Set `sfcTransform: "all"` when SFCs without `<locale>` blocks or `defineInternationalization()` still need `$locale.env` or `$l.env` global dictionary access:

```json
{
  "vueCompilerOptions": {
    "plugins": [
      {
        "name": "vite-vue-internationalization/volar",
        "primaryLocale": "ja-JP",
        "sfcTransform": "all"
      }
    ]
  }
}
```

Vite build output keeps global `env` bindings as broad runtime dictionary types to avoid duplicating large global type literals in every transformed SFC. Vue Language Tools / Volar still uses the detailed global dictionary types for editor completion and `vue-tsc`.

```ts
// src/env.d.ts
/// <reference types="vite-vue-internationalization/virtual" />
```

```ts
// src/main.ts
import { createApp } from 'vue';
import { createInternationalization } from 'virtual:vite-vue-internationalization';
import App from './App.vue';

const app = createApp(App);
const internationalization = createInternationalization();

app.use(internationalization);
await internationalization.ready;
app.mount('#app');
```

## Documentation Pages

- English:
  - [Getting Started](./docs/en/getting-started.md)
  - [Configuration](./docs/en/configuration.md)
  - [Messages](./docs/en/messages.md)
  - [Message Syntax](./docs/en/message-syntax.md)
  - [Build Strategy](./docs/en/build-strategy.md)
- Japanese:
  - [はじめる](./docs/getting-started.md)
  - [設定](./docs/configuration.md)
  - [メッセージ定義](./docs/messages.md)
  - [メッセージ構文](./docs/message-syntax.md)
  - [ビルド戦略](./docs/build-strategy.md)
  - [API リファレンス](./docs/api.md)

## Examples

- [Vue syntax example on StackBlitz](https://stackblitz.com/github/tamaina/vite-vue-internationalization?startScript=example%3Avue&title=vite-vue-internationalization%20Vue%20syntax)
- [ICU syntax example on StackBlitz](https://stackblitz.com/github/tamaina/vite-vue-internationalization?startScript=example%3Aicu&title=vite-vue-internationalization%20ICU%20syntax)

To view the documentation locally:

```sh
pnpm docs:dev
```
