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
    vueInternationalization(),
    vue()
  ]
});
```

```json
// tsconfig.json
{
  "vueCompilerOptions": {
    "plugins": [
      {
        "name": "vue-internationalization/volar",
        "primaryLocale": "ja-JP",
        "buildStrategy": "inline-chunks",
        "global": {
          "ja-JP": "./src/locales/ja-JP.yaml",
          "en-US": "./src/locales/en-US.yaml"
        }
      }
    ]
  }
}
```

`vueInternationalization()` に options を渡さない場合、Vite plugin は `tsconfig.json` の `vueCompilerOptions.plugins` から `vue-internationalization/volar` 設定を読みます。VS Code / Vue Language Tools も同じ設定を使うため、`primaryLocale` や `global` を二重管理する必要はありません。

```ts
// main.ts
import { createApp } from 'vue';
import { createInternationalization } from 'virtual:vue-internationalization';
import App from './App.vue';

const app = createApp(App);
const internationalization = createInternationalization();

app.use(internationalization);
await internationalization.ready;
app.mount('#app');
```

初期 locale は `?locale=en-US` のような URL query から決まります。locale を切り替える場合は Vue runtime state を差し替えず、URL を変更して対応する locale entry で起動し直します。

`{name}` 形式の引数つきメッセージは `$l` から関数として参照できます。`$locale` は翻訳値をそのまま返し、`$l` は同じ `global` / `module` scope の localizer 関数を返します。

```vue
<template>
  <p>{{ $locale.module.title }}</p>
  <p>{{ $l.module.nApples({ n: 3 }) }}</p>
</template>

<locale locale="ja-JP" lang="yaml">
title: りんご
nApples: "{n} 個のりんご"
</locale>
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
このモードでは HTML loader が `locale` query を見て locale chunk を選択します。

```sh
pnpm --dir examples/motivation-1 build
```

## テスト

```sh
pnpm test
pnpm typecheck
```
