# ビルド戦略

[`buildStrategy`](./configuration.md) は、ロケールをどのようにバンドルへ反映するかを選びます。Vite プラグインの導入は [はじめる](./getting-started.md) を参照してください。

## 仮想モジュール（`virtual`）

仮想モジュール（`virtual`）は通常の戦略です。ロケールごとの仮想モジュールを `import()` し、Viteビルドでロケールチャンクを分離します。

## インライン化チャンク（`inline-chunks`）

インライン化チャンク（`inline-chunks`）は、ビルド時に翻訳対象チャンクをロケールごとに複製し、`$locale` / `$l` の参照をそのロケール向けの文字列リテラル、辞書オブジェクト、またはメッセージ展開式に置換します。

主要ロケールを含む各ロケールは `*.ja-JP.js` や `*.en-US.js` のようなロケール別チャンクとして出力されます。HTML の entry script は `*.i18n-loader.js` に差し替えられ、このローダーが `locale` クエリを見て対応するロケールチャンクを読み込みます。`locale` が未指定、または未対応の場合は主要ロケールのチャンクを読み込みます。

この戦略はロケール数に比例して出力ファイル数と合計配信サイズが増えます。

関連 API:

- [`VueInternationalizationOptions`](./api.md#vueinternationalizationoptions)
- [`vueInternationalization()`](./api.md#vueinternationalization)
- [`createInternationalization()`](./api.md#createinternationalization)

次に読む:

- プラグインオプションは [設定](./configuration.md)
- 実行時のセットアップは [はじめる](./getting-started.md)
