llms.txt は、 npm でこのパッケージを公開する際にバンドルされ、 利用者が依頼したエージェントが このパッケージを利用する際に注意すべきことが書かれています。

@llms.txt

docs 以下にこのパッケージのドキュメントがあります。日本語版は docs 直下、英語版は docs/en 以下にあります。VitePress の設定は docs/.vitepress と docs/vitepress.config.ts にあります。

このソースコードの簡単な構造:

- src/index.ts はパッケージの主な公開エントリです。
- src/plugin.ts は Vite プラグイン本体、src/runtime.ts は runtime エントリ向けの API、src/volar.ts は Volar / Vue Language Tools 向けのプラグインです。
- src/parse.ts、src/message.ts、src/files.ts、src/inline.ts は Vue SFC の locale 情報、メッセージ、ファイル処理、inline-chunks ビルド戦略まわりの実装です。
- src/localeEnv.ts、src/localeTypes.ts、src/types.ts、src/virtual.d.ts は型や仮想モジュール関連の定義です。
- test 以下に Vitest のテストがあります。
- examples 以下に動作確認用の Vue / ICU サンプルがあります。
- scripts 以下に API ドキュメント生成や Volar CJS ビルドなどの補助スクリプトがあります。
- dist はビルド成果物です。通常は src を編集し、dist を直接編集しません。
