# Messages

This page covers where locale messages live. See [Configuration](./configuration.md) for plugin options and [Message Syntax](./message-syntax.md) for placeholders and pluralization.

## SFC `<locale>` blocks

Vue SFCs can contain one `<locale>` custom block per locale. `lang` can be `yaml` or `json`.

```vue
<template>
  <h1>{{ $locale.sfc.title }}</h1>
  <p>{{ $l.sfc.count({ n }) }}</p>
</template>

<script setup lang="ts">
const n = 3;
</script>

<locale locale="en-US" lang="yaml">
title: Apples
count: "{n} apples"
</locale>
```

SFC local messages are available through `$locale.sfc` and `$l.sfc`. `$locale` returns raw message values, while `$l` returns message functions.

When a SFC contains multiple `<locale>` blocks for the same locale, dictionaries are merged recursively and later blocks override earlier values.

## Global dictionary

Shared application messages are configured through the `global` option. Global messages are available through `$locale.env` and `$l.env`.

```json
{
  "vueCompilerOptions": {
    "plugins": [
      {
        "name": "vite-vue-internationalization/volar",
        "primaryLocale": "en-US",
        "global": {
          "en-US": "./src/locales/en-US/**/*.yaml",
          "ja-JP": "./src/locales/ja-JP/**/*.yaml"
        }
      }
    ]
  }
}
```

```yaml
# src/locales/en-US/base.yaml
appName: Example
navigation:
  home: Home
```

```vue
<template>
  <p>{{ $locale.env.appName }}</p>
  <p>{{ $locale.env.navigation.home }}</p>
</template>
```

Each locale in `global` can be an object, file path, glob, or array of paths. If multiple files define the same key path, the plugin warns and later files override earlier values.

## Locale-only SFC

A locale-only SFC has `<locale>` blocks without `<template>` or `<script>`. Use it as a typed message module that is independent from a component.

```vue
<!-- messages.vue -->
<locale locale="en-US" lang="yaml">
title: Locale-only Vue file
body: "This message was imported from {source}"
</locale>

<locale locale="ja-JP" lang="yaml">
title: locale だけの Vue ファイル
body: "{source} から import した翻訳です"
</locale>
```

```ts
import Messages from './messages.vue';

Messages.$locale.title;
Messages.$l.body({ source: 'messages.vue' });
```

## Script-defined messages

Use `defineInternationalization()` at the top level of a normal `<script lang="ts">` or `<script setup lang="ts">` block when you want to define dictionaries in TypeScript.

```vue
<script lang="ts">
import { defineInternationalization } from 'vite-vue-internationalization';

defineInternationalization({
  'en-US': {
    greeting: (values?: { name?: string }) => `Hello ${values?.name ?? 'there'}`,
  },
  'ja-JP': {
    greeting: (values?: { name?: string }) => `こんにちは ${values?.name ?? '名無し'}`,
  },
});
</script>
```

When `buildStrategy: 'inline-chunks'` or script-defined locale extraction serializes functions, the function source is emitted. Keep message functions self-contained and avoid depending on outer closures.

Related API:

- [`defineInternationalization()`](../api.md#defineinternationalization)
- [`LocaleDictionary`](../api.md#localedictionary)
- [`LocaleMessages`](../api.md#localemessages)

