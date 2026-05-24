# はじめる

このページでは最小構成を扱います。各オプションの詳細は [設定](./configuration.md)、メッセージの置き方は [メッセージ定義](./messages.md)、メッセージの書き方は [メッセージ構文](./message-syntax.md)、公開 API の型は [API リファレンス](./api.md) を参照してください。

## Vite プラグイン

```ts
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

[`vueInternationalization()`](./api.md#vueinternationalization) にオプションを渡さない場合、Vite ルートの `tsconfig.json` にある `vueCompilerOptions.plugins` から設定を読みます。設定の共有方法は [設定](./configuration.md) にまとめています。

## 基本設定

型生成の基準になる `primaryLocale` と、プロジェクト全体で使うメッセージ構文（`messageSyntax`）を選びます。VS Code や `vue-tsc` でも同じ設定を使えるように、Vite ルートの `tsconfig.json` に記載することをおすすめします。

```json
{
  "vueCompilerOptions": {
    "plugins": [
      {
        "name": "vite-vue-internationalization/volar",
        "primaryLocale": "ja-JP",
        "messageSyntax": "vue"
      }
    ]
  }
}
```

`messageSyntax` は `vue` または `icu` を指定します。`vue` は Vue I18n 互換の軽量構文、`icu` は FormatJS ICU Message syntax を使います。構文ごとの書き方は [メッセージ構文](./message-syntax.md) を参照してください。

## 型定義

アプリ側の `env.d.ts` に [`virtual:vite-vue-internationalization`](./api.md#virtual) の型を追加します。

```ts
/// <reference types="vite-vue-internationalization/virtual" />
```

## Vue アプリ

```ts
import { createApp } from 'vue';
import { createInternationalization } from 'virtual:vite-vue-internationalization';
import App from './App.vue';

const app = createApp(App);
const internationalization = createInternationalization();

app.use(internationalization);
await internationalization.ready;
app.mount('#app');
```

[`createInternationalization()`](./api.md#createinternationalization) は、生成されたロケール読み込み関数を持つ実行時インスタンスを作ります。初期ロケールは `?locale=en-US` のような URL クエリから決まります。

## SFC メッセージ

```vue
<template>
  <h1>{{ $locale.sfc.title }}</h1>
  <p>{{ $locale.env.appName }}</p>
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
title: apple
count: "an apple | {n} apples"
</locale>
```

`$locale` は翻訳値をそのまま返し、`$l` はローカライザー関数を返します。`$l` で使えるプレースホルダー（`placeholder`）や複数形選択（`plural`）の詳細は [メッセージ構文](./message-syntax.md) を参照してください。

次に読む:

- グローバル辞書（`env`/`global`）や走査対象（`scan`）を設定する場合は [設定](./configuration.md)
- `<locale>` ブロックや単体メッセージ SFC を整理する場合は [メッセージ定義](./messages.md)
- ロケールチャンクの出力を確認する場合は [ビルド戦略](./build-strategy.md)
- 実行時ヘルパーの型を確認する場合は [API リファレンス](./api.md)
