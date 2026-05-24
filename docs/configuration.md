# 設定
Vite ルートの `tsconfig.json` にある `vueCompilerOptions.plugins`、もしくはViteプラグイン関数（`vueInternationalization()`）の引数で設定します。

VS Codeやvue-tscで型を取得するために、Viteルート`tsconfig.json`での設定をおすすめします。

```json
{
  "vueCompilerOptions": {
    "plugins": [
      {
        "name": "vite-vue-internationalization/volar",
        "primaryLocale": "ja-JP",
        "messageSyntax": "vue",
        "buildStrategy": "virtual",
        "scan": {
          "include": "src/**/*.vue",
          "exclude": ["src/legacy/**"]
        },
        "global": {
          "ja-JP": "./src/locales/ja-JP/**/*.yaml",
          "en-US": "./src/locales/en-US/**/*.yaml"
        }
      }
    ]
  }
}
```

| 項目 | 初期値 | 説明 |
| --- | --- | --- |
| [`primaryLocale`](./api.md#vueinternationalizationoptions) | 必須 | 型生成の基準になるロケールです。 |
| [`global`](./messages.md#global-dictionary) | `undefined` | ロケールごとのグローバル辞書の入力元です。 |
| [`buildStrategy`](./build-strategy.md) | `virtual` | `virtual` または `inline-chunks` を指定します。 |
| `scan.include` | `**/*.vue` | 起動時に収集する Vue ファイルを絞ります。 |
| `scan.exclude` | `[]` | 収集対象から外す Vue ファイルです。 |
| [`messageSyntax`](./message-syntax.md) | `vue` | `vue` または `icu` をプロジェクト全体で選びます。 |
| `localizerDocumentation` | `true` | Volar のホバー表示に出す `$l` 用 JSDoc 生成を制御します。 |

現在の Vite プラグインは `tsconfig.app.json` など別名の設定ファイルを自動探索しません。別名の tsconfig に設定を置く場合は、ルートの `tsconfig.json` にも `vueCompilerOptions.plugins` を置くか、[`vueInternationalization({ primaryLocale, global, messageSyntax })`](./api.md#vueinternationalization) に明示してください。

関連 API:

- [`VueInternationalizationOptions`](./api.md#vueinternationalizationoptions)
- [`vueInternationalization()`](./api.md#vueinternationalization)
- [`LocaleMessages`](./api.md#localemessages)

次に読む:

- メッセージ形式を選ぶ場合は [メッセージ構文](./message-syntax.md)
- `<locale>` ブロックやグローバル辞書（`env`/`global`）を書く場合は [メッセージ定義](./messages.md)
- チャンク出力を選ぶ場合は [ビルド戦略](./build-strategy.md)
