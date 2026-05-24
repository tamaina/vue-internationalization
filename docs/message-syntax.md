# メッセージ構文

[`messageSyntax`](./configuration.md) はプロジェクト全体で `vue` または `icu` を選びます。辞書ごとの混在はサポートしません。型生成に使うヘルパーの詳細は [API リファレンス](./api.md) にあります。

## Vue I18n 互換構文（`vue`）

Vue I18n 互換構文（`vue`）は [vue-i18n のメッセージ形式](https://vue-i18n.intlify.dev/guide/essentials/syntax) に寄せた軽量構文です。

```yaml
named: "こんにちは {user-name}"
list: "{0} と {1} の翻訳"
literal: "{'@'} は linked message ではありません"
plural: "りんごなし | りんごひとつ | りんご {count} 個"
target: "リンク先メッセージ"
linked: "@.upper:target"
```

対応している構文:

- 名前付き埋め込み（`named interpolation`）: `{name}` / `{user-name}`
- リスト埋め込み（`list interpolation`）: `{0}` / `{1}`
- リテラル埋め込み（`literal interpolation`）: `{'@'}` / `{"@"}`
- 複数形選択（`pluralization`）: `no apples | one apple | {count} apples`
- リンクメッセージ（`linked messages`）: `@:target` / `@.lower:target` / `@.upper:target` / `@.capitalize:target`

## ICU メッセージ構文（`icu`）

ICU メッセージ構文（`icu`）は [FormatJS ICU Message syntax](https://formatjs.github.io/docs/core-concepts/icu-syntax/) のパーサーと実行時処理で扱います。

```yaml
hello: "Hello {name}"
apples: "{count, plural, =0 {No apples} one {One apple} other {# apples}}"
invite: "{gender, select, female {She invited {count, plural, one {one guest} other {# guests}}} other {They invited {count, plural, one {one guest} other {# guests}}}}"
```

ICU メッセージ構文（`icu`）では、リンクメッセージ構文やパイプ区切りの複数形選択（`pipe plural`）は使いません。

関連 API:

- [`formatLocaleMessage()`](./api.md#formatlocalemessage)
- [`getLocaleMessageNamedKeys()`](./api.md#getlocalemessagenamedkeys)
- [`getLocaleMessageListIndexes()`](./api.md#getlocalemessagelistindexes)
- [`hasLocaleMessagePlural()`](./api.md#haslocalemessageplural)
- [`LocaleMessageSyntax`](./api.md#localemessagesyntax)

次に読む:

- `messageSyntax` の設定場所は [設定](./configuration.md)
- 実行時に `$l` を使う流れは [はじめる](./getting-started.md)
