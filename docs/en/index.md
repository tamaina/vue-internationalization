# vite-vue-internationalization

A Vite plugin for typed Vue SFC translations with ***SFC custom blocks*** and ***inline locale chunks***.

`VVI` is the short name for `vite-vue-internationalization`.

## Features

### SFC Custom Blocks

Define translation dictionaries in Vue SFC `<locale>` custom blocks.  
Read them through `$locale.sfc` and `$l.sfc`.

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

### Inline Chunks

Embed messages into each chunk, replace static access with text where possible, and emit per-locale files.

### Two Message Syntaxes

Supports Vue I18n compatible syntax (`vue`) and ICU message syntax (`icu`).

### TypeScript Types

Injects TypeScript types into Vue Language Tools / Volar based on the primary locale dictionary.  
This supports type checking in `vue-tsc` and type annotations in the official Vue VS Code extension.

## Documentation

- [Getting Started](./getting-started.md): Vite plugin, type declarations, app installation, and SFC messages
- [Configuration](./configuration.md): `primaryLocale`, `global`, `messageSyntax`, `buildStrategy`, `scan`, and `sfcTransform`
- [Messages](./messages.md): `<locale>` blocks, global dictionaries, locale-only SFCs, and script-defined messages
- [Message Syntax](./message-syntax.md): `vue` syntax and `icu` syntax
- [Build Strategy](./build-strategy.md): choosing between `virtual` and `inline-chunks`
- [Backend HTML Rendering](./backend-rendering.md): render Vue to an HTML string in Vite SSR environments such as Cloudflare Workers
- [API Reference](../api.md): generated from English JSDoc comments

## Links

- [GitHub repository](https://github.com/tamaina/vite-vue-internationalization)
- [npm package](https://www.npmjs.com/package/vite-vue-internationalization)
- [GitHub Sponsors](https://github.com/sponsors/tamaina)

## Examples

- [Open the Vue syntax example on StackBlitz](https://stackblitz.com/github/tamaina/vite-vue-internationalization?startScript=example%3Avue&title=vite-vue-internationalization%20Vue%20syntax)
- [Open the ICU syntax example on StackBlitz](https://stackblitz.com/github/tamaina/vite-vue-internationalization?startScript=example%3Aicu&title=vite-vue-internationalization%20ICU%20syntax)

Related external docs:

- [Vue SFC custom blocks](https://vuejs.org/api/sfc-spec.html#custom-blocks)
- [Vite plugin API](https://vite.dev/guide/api-plugin.html)
- [Vue Language Tools](https://github.com/vuejs/language-tools)
- [TypeDoc](https://typedoc.org/)

Start with [Getting Started](./getting-started.md).
