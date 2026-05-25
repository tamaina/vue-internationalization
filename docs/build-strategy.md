# ビルド戦略

[`buildStrategy`](./configuration.md) は、ロケールをどのようにバンドルへ反映するかを選びます。Vite プラグインの導入は [はじめる](./getting-started.md) を参照してください。

## 仮想モジュール（`virtual`）

仮想モジュール（`virtual`）は通常の戦略です。ロケールごとの仮想モジュールを `import()` し、Viteビルドでロケールチャンクを分離します。

## インライン化チャンク（`inline-chunks`）

インライン化チャンク（`inline-chunks`）は、ビルド時に翻訳対象チャンクをロケールごとに複製し、`$locale` / `$l` の参照をそのロケール向けの文字列リテラル、辞書オブジェクト、またはメッセージ展開式に置換します。

主要ロケールを含む各ロケールは `*.ja-JP.js` や `*.en-US.js` のようなロケール別チャンクとして出力されます。HTML の entry script は `*.i18n-loader.js` に差し替えられ、このローダーが `locale` クエリを見て対応するロケールチャンクを読み込みます。`locale` が未指定、または未対応の場合は主要ロケールのチャンクを読み込みます。

差し替え後の `<script>` では `nonce`、`crossorigin`、`referrerpolicy` などの既存属性を保持します。元の entry script に `integrity` がある場合は、生成された loader 用の integrity に差し替えます。loader は選択したロケールチャンクを `modulepreload` とロケールチャンクごとの integrity で検証してから `import()` します。

### インライン化できない参照

静的な `$locale.sfc.title`、`$locale.env.title`、`$l.sfc.count({ n })` はロケール別の文字列リテラルまたはメッセージ展開式へ置換されます。`$locale.env.labels[key]` のように途中から動的キーになる参照は、解決できる静的な部分木をロケール別オブジェクトとして埋め込み、実行時の lookup 式を残します。

ビルド時に解決できないパスや複雑すぎる `$l` 呼び出しは、主要ロケールの値にフォールバックし、それもなければ `$locale.sfc.missingKey` のようなキー文字列を返します。置換できない JavaScript はそのまま黙って残さず、ビルド時エラーになります。

この戦略はロケール数に比例して出力ファイル数と合計配信サイズが増えます。

関連 API:

- [`VueInternationalizationOptions`](./api.md#vueinternationalizationoptions)
- [`vueInternationalization()`](./api.md#vueinternationalization)
- [`createInternationalization()`](./api.md#createinternationalization)

次に読む:

- プラグインオプションは [設定](./configuration.md)
- 実行時のセットアップは [はじめる](./getting-started.md)
