# vue-internationalization

## モチベーション1
### 1: Vueのファイル内でカスタムブロックを使ってinternationalizationを定義

`locale`カスタムブロックの中でyamlやjsonで定義します。  
プライマリ言語をViteなどで情報提供し、プライマリ言語からtemplate/script内で型推測が効くようにします。

もちろんパーツはグローバルでも定義できるようにします。

```vue
<script lang="ts" setup>
// nothing to do
</script>

<template>
  <div :class="$style.hoge">{{ $locale.module.hoge }}</div>
  <span>{{ $locale.global.fuga }}</span>
</template>

<style lang="scss" module>
.hoge {
  color: #f00;
}
</style>

<locale locale="ja-JP" lang="yaml">
hoge: ほげ
</locale>

<locale locale="en-US" lang="yaml">
hoge: foo
nApples: {n} apples
</locale>
```

## モチベーション2
Viteにおいて、Vueファイルの各言語版に言語部分を置き換え分離し、チャンクを発生させ、クライアントで言語を選択することでチャンクを読み替えられるようにする

## 現在の実装

- Vite plugin: `vueInternationalization({ primaryLocale, global })`
- Runtime: `virtual:vue-internationalization` から `createInternationalization()` / `useLocale()` を提供
- Vue SFC の `<locale locale="..." lang="yaml|json">` を収集
- `<locale>` ブロックを Vue plugin に渡す前に除去し、`script setup` に `$locale` binding を自動注入
- locale ごとの仮想モジュールを `import()` するため、Vite build で locale chunk が分離される
- `buildStrategy: 'inline-chunks'` を指定すると、build 時に Vue chunk を locale ごとに複製し、`$locale` の中身を直接 JSON に置換する
- グローバル辞書は plugin option の `global` で locale ごとに YAML/JSON ファイルまたは object を指定可能

## 使い方

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { vueInternationalization } from 'vue-internationalization';

export default defineConfig({
  plugins: [
    vueInternationalization({
      primaryLocale: 'ja-JP',
      buildStrategy: 'inline-chunks',
      global: {
        'ja-JP': './src/locales/ja-JP.yaml',
        'en-US': './src/locales/en-US.yaml'
      }
    }),
    vue()
  ]
});
```

```ts
// main.ts
import { createApp } from 'vue';
import { createInternationalization } from 'virtual:vue-internationalization';
import App from './App.vue';

const app = createApp(App);
const internationalization = createInternationalization({ initialLocale: 'ja-JP' });

app.use(internationalization);
await internationalization.ready;
app.mount('#app');
```

`virtual:vue-internationalization` の型を使う場合は、アプリ側の `env.d.ts` に追加します。

```ts
/// <reference types="vue-internationalization/virtual" />
```

## サンプル

```sh
pnpm install
pnpm build
pnpm --dir examples/motivation-1 dev
```

production build では `ja-JP` / `en-US` が別 chunk として出力されます。
`buildStrategy: 'inline-chunks'` の場合、primary locale は通常の chunk に埋め込まれ、その他の locale は `*.en-US.js` のような別ファイルとして出力されます。
このモードは build 出力を書き換えるための土台で、生成された locale chunk をどの HTML/loader から選択するかはアプリ側または次の plugin 機能で扱います。

```sh
pnpm --dir examples/motivation-1 build
```

## テスト

```sh
pnpm test
pnpm typecheck
```
