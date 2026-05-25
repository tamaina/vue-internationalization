# vite-vue-internationalization
***SFCカスタムブロック*** と ***インライン化チャンク*** で、Vite + Vueアプリの国際化を簡単にしましょう！

`VVI` は `vite-vue-internationalization` の略称です。

## 特長 / Features

### SFC カスタムブロック
Vue SFC の `<locale>` カスタムブロックで翻訳辞書を定義します。  
`$locale.sfc` および `$l.sfc` から読み出すことができます。

```vue
<template>
  <h1>{{ $locale.sfc.title }}</h1>
  <p>{{ $l.sfc.count({ n: 3 }) }}</p>
</template>

<locale locale="ja-JP" lang="yaml">
title: りんご
count: "{n} 個のりんご"
</locale>

<locale locale="en-US" lang="yaml">
title: apple
count: "an apple | {n} apples"
</locale>
```

### インライン化チャンク
各チャンクにメッセージを埋め込み、可能な箇所はテキストに置き換え、各言語ごとに個別ファイルを出力します。

### 2つのメッセージ構文
Vue I18n 互換構文（`vue`）と ICU メッセージ構文（`icu`）に対応します。

### TypeScript 型対応
プライマリ言語の辞書に基づいて、Vue Language Tools / Volar によってTypeScript型を注入します。  
vue-tscでの型検査、Vue公式 VS Code 拡張機能での型注釈に対応します。

## ドキュメント

- [はじめる](./getting-started.md): Vite プラグイン、型定義、Vue アプリへの導入、SFC メッセージの最小セットアップ
- [設定](./configuration.md): `primaryLocale`、`global`、`messageSyntax`、`buildStrategy`、`scan`、`sfcTransform` の指定
- [メッセージ定義](./messages.md): `<locale>` ブロック、グローバル辞書（`env`/`global`）、単体メッセージ SFC、スクリプト定義メッセージ
- [メッセージ構文](./message-syntax.md): Vue I18n 互換構文（`vue`）と ICU メッセージ構文（`icu`）の違い
- [ビルド戦略](./build-strategy.md): 仮想モジュール（`virtual`）とインライン化チャンク（`inline-chunks`）の使い分け
- [API リファレンス](./api.md): JSDoc から生成した API リファレンス

## リンク

- [GitHub リポジトリ](https://github.com/tamaina/vite-vue-internationalization)
- [npm パッケージ](https://www.npmjs.com/package/vite-vue-internationalization)

## Examples

- [Vue I18n 互換構文の例を StackBlitz で開く](https://stackblitz.com/github/tamaina/vite-vue-internationalization?startScript=example%3Avue&title=vite-vue-internationalization%20Vue%20syntax)
- [ICU メッセージ構文の例を StackBlitz で開く](https://stackblitz.com/github/tamaina/vite-vue-internationalization?startScript=example%3Aicu&title=vite-vue-internationalization%20ICU%20syntax)

関連する外部ドキュメント:

- [Vue SFC カスタムブロック](https://vuejs.org/api/sfc-spec.html#custom-blocks)
- [Vite プラグイン API](https://vite.dev/guide/api-plugin.html)
- [Vue Language Tools](https://github.com/vuejs/language-tools)
- [TypeDoc](https://typedoc.org/)

まずは [はじめる](./getting-started.md) から進めてください。
