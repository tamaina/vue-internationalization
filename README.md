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
  <div :class="$style.hoge">{{ $locale.sfc.hoge }}</div>
  <span>{{ $locale.env.fuga }}</span>
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
- 同じ SFC に同一 locale の `<locale>` ブロックが複数ある場合は再帰的にマージし、後のブロックの値で上書きする
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
      messageSyntax: 'vue'
    }),
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
        "messageSyntax": "vue",
        "scan": {
          "include": "src/**/*.vue",
          "exclude": ["src/legacy/**"]
        },
        "localizerDocumentation": false,
        "global": {
          "ja-JP": "./src/locales/ja-JP/**/*.yaml",
          "en-US": [
            "./src/locales/en-US/base.yaml",
            "./src/locales/en-US/features/**/*.yaml"
          ]
        }
      }
    ]
  }
}
```

`vueInternationalization()` に options を渡さない場合、Vite plugin は `tsconfig.json` の `vueCompilerOptions.plugins` から `vue-internationalization/volar` 設定を読みます。VS Code / Vue Language Tools も同じ設定を使うため、`primaryLocale` や `global` を二重管理する必要はありません。
`global` の各 locale には object、ファイルパス、glob、またはパス配列を指定できます。複数ファイルに同じ key path がある場合は warning を出し、後から読み込まれたファイルの値で上書きします。
`scan.include` / `scan.exclude` は Vite plugin が起動時に収集する Vue ファイルを絞り込むための glob です。大きいリポジトリでは `src/**/*.vue` のように対象を限定してください。
`messageSyntax` は project 全体で `'vue'` または `'icu'` を選びます。辞書ごとの混在はサポートしません。default は `'vue'` です。
`localizerDocumentation: false` を指定すると、Volar が `$l` の hover 用 JSDoc を生成しません。巨大な辞書でエディターの応答が重い場合に有効です。

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

`$locale` は翻訳値をそのまま返し、`$l` は同じ `global` / `module` scope の localizer 関数を返します。
`$l` の文字列メッセージは vue-i18n の message format syntax に寄せた構文を解釈します。

```vue
<script setup lang="ts">
const n = 3;
</script>

<template>
  <p>{{ $locale.sfc.title }}</p>
  <p>{{ $l.sfc.nApples({ n: 3 }) }}</p>
  <p>{{ $l.sfc.named({ 'user-name': 'Vue' }) }}</p>
  <p>{{ $l.sfc.list(['SFC', 'local']) }}</p>
  <p>{{ $l.sfc.literal() }}</p>
  <p>{{ $l.sfc.plural({ count: n }, n) }}</p>
  <p>{{ $l.sfc.linked() }}</p>
</template>

<locale locale="ja-JP" lang="yaml">
title: りんご
nApples: "{n} 個のりんご"
named: "こんにちは {user-name}"
list: "{0} と {1} の翻訳"
literal: "{'@'} は linked message ではありません"
plural: "りんごなし | りんご 1 個 | りんご {count} 個"
target: "リンク先メッセージ"
linked: "@.upper:target"
</locale>
```

`messageSyntax: 'vue'` で対応している message syntax:

- named interpolation: `{name}` / `{user-name}`
- list interpolation: `{0}` / `{1}`
- literal interpolation: `{'@'}` / `{"@"}`
- pluralization: `no apples | one apple | {count} apples`
- linked messages: `@:target` / `@.lower:target` / `@.upper:target` / `@.capitalize:target`

pluralization は `$l.sfc.key(plural)` または `$l.sfc.key(values, plural)` で選択します。2 variants の場合は `1` が先頭、それ以外が後続です。3 variants 以上の場合は `0` / `1` / other の順に選択します。
linked message は同じ scope の root から key path を解決します。未解決の linked message や循環参照は `@:key` の表示で停止します。

`messageSyntax: 'icu'` では ICU MessageFormat を使います。ICU message は FormatJS の parser/runtime で扱い、型生成も ICU AST から必要な values key を抽出します。

```yaml
hello: "Hello {name}"
apples: "{count, plural, =0 {No apples} one {One apple} other {# apples}}"
invite: "{gender, select, female {She invited {count, plural, one {one guest} other {# guests}}} other {They invited {count, plural, one {one guest} other {# guests}}}}"
```

```vue
<template>
  <p>{{ $l.sfc.apples({ count }) }}</p>
  <p>{{ $l.sfc.invite({ gender, count }) }}</p>
</template>
```

`messageSyntax: 'icu'` では linked message syntax や pipe plural は使いません。`messageSyntax: 'vue'` では ICU MessageFormat を使いません。

Programmatic dictionary では message function も leaf value として使えます。YAML/JSON の `<locale>` block は静的解析のため文字列辞書のままですが、Vite plugin options や runtime loader で渡す辞書では関数を localizer から呼び出せます。

SFC では通常の `<script lang="ts">` / `<script setup lang="ts">` の top-level で `defineInternationalization()` を使えます。

```vue
<script lang="ts">
import { defineInternationalization } from 'vue-internationalization';

export const messages = defineInternationalization({
	'ja-JP': {
		title: 'ほげ',
		greeting: (values?: { name?: string }) => `こんにちは ${values?.name ?? '名無し'}`,
	},
	'en-US': {
		title: 'foo',
		greeting: (values?: { name?: string }) => `Hello ${values?.name ?? 'there'}`,
	},
});
</script>
```

Vite plugin options や runtime loader で渡す辞書にも同じ関数を使えます。

```ts
const global = {
	'en-US': {
		greeting: (values?: { name?: string }) => `Hello ${values?.name ?? 'there'}`,
	},
};
```

message function は `(values?, plural?) => string` です。`buildStrategy: 'inline-chunks'` や script-defined locale 抽出では関数を source として出力するため、外側の closure に依存しない self-contained な関数にしてください。

Component interpolation は `Internationalization` component で扱います。`message` を直接渡すか、`locale` / `scope` / `path` で `$locale` の値を参照します。message 内の `{name}` は、同名 slot があれば slot に置換し、slot がなければ `values` で文字列補間します。

```vue
<script setup lang="ts">
import { Internationalization } from 'virtual:vue-internationalization';
</script>

<template>
  <Internationalization
    :locale="$locale"
    scope="sfc"
    path="terms"
    :values="{ service: 'Example', link: '利用規約' }"
  >
    <template #link="{ text }">
      <a href="/terms">{{ text }}</a>
    </template>
  </Internationalization>
</template>

<locale locale="ja-JP" lang="yaml">
terms: "{service} の {link} を確認してください"
</locale>
```

現時点の component interpolation は named slot placeholder の差し替えが対象です。上の例では `{link}` が slot に置換され、slot props の `text` には `values.link` の文字列が入ります。`{/link}` のような閉じ tag 風 syntax はまだ構造化されず、通常の text として扱われます。

DateTime / Number formatting は `Intl.DateTimeFormat` / `Intl.NumberFormat` の薄い wrapper として提供します。format preset は翻訳辞書ではなく runtime options に置きます。

```ts
import { createInternationalization, useDateTimeFormat, useNumberFormat } from 'virtual:vue-internationalization';

const internationalization = createInternationalization({
	dateTimeFormats: {
		'ja-JP': {
			short: { dateStyle: 'short', timeZone: 'Asia/Tokyo' },
		},
	},
	numberFormats: {
		'ja-JP': {
			currency: { style: 'currency', currency: 'JPY' },
		},
	},
});

const d = useDateTimeFormat();
const n = useNumberFormat();

d.value(new Date(), 'short');
n.value(1200, 'currency');
n.value(0.25, { style: 'percent' });
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
pnpm --dir examples/icu dev
```

production build では `ja-JP` / `en-US` が別 chunk として出力されます。
`buildStrategy: 'inline-chunks'` の場合、primary locale は通常の chunk に埋め込まれ、その他の locale は `*.en-US.js` のような別ファイルとして出力されます。
このモードでは HTML loader が `locale` query を見て locale chunk を選択します。
`inline-chunks` は localizable chunk を locale ごとに複製するため、locale 数に比例して出力ファイル数と合計配信サイズが増えます。多数の locale を扱う場合は、通常の `virtual` strategy の chunk splitting を優先してください。

```sh
pnpm --dir examples/motivation-1 build
pnpm --dir examples/icu build
```

## テスト

```sh
pnpm test
pnpm typecheck
```
