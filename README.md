# vite-vue-internationalization

Vue SFC に翻訳をそのまま置ける、Vite 向けの型付き国際化プラグインです。

`<locale>` カスタムブロック、グローバル辞書、Volar 型補完、ロケール別チャンク出力をまとめて扱えます。

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

## 特長

- Vue SFC の `<locale>` ブロックに YAML / JSON で翻訳を書ける
- `$locale` と `$l` に型が付き、テンプレートでも TypeScript でも補完できる
- アプリ全体のグローバル辞書も同じ API で参照できる
- Vue I18n 互換構文（`vue`）と ICU メッセージ構文（`icu`）を選べる
- `virtual` と `inline-chunks` の 2 つのビルド戦略を選べる
- Vite プラグインと Vue Language Tools / Volar で同じ設定を共有できる

## 最小構成

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

## ドキュメント

- [はじめる](./docs/getting-started.md)
- [設定](./docs/configuration.md)
- [メッセージ定義](./docs/messages.md)
- [メッセージ構文](./docs/message-syntax.md)
- [ビルド戦略](./docs/build-strategy.md)
- [API リファレンス](./docs/api.md)

## Examples

- [Vue syntax example on StackBlitz](https://stackblitz.com/github/tamaina/vite-vue-internationalization?startScript=example%3Avue&title=vite-vue-internationalization%20Vue%20syntax)
- [ICU syntax example on StackBlitz](https://stackblitz.com/github/tamaina/vite-vue-internationalization?startScript=example%3Aicu&title=vite-vue-internationalization%20ICU%20syntax)

ローカルでドキュメントを見る場合:

```sh
pnpm docs:dev
```
