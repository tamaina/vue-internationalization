# Build Strategy

[`buildStrategy`](./configuration.md) controls how locale payloads are reflected in the built bundle.

## `virtual`

The default strategy. Locale modules are loaded through dynamic `import()` calls so [Vite build](https://vite.dev/guide/build.html) can split locale chunks.

## `inline-chunks`

Build-time strategy that duplicates localizable chunks per locale and replaces `$locale` / `$l` references with locale-specific string literals, dictionary objects, or message formatting expressions.

Each locale, including the primary locale, is emitted as a locale-specific chunk such as `*.ja-JP.js` or `*.en-US.js`. The HTML entry script is replaced with a `*.i18n-loader.js` loader, which reads the `locale` query parameter and imports the matching locale chunk. When `locale` is missing or unsupported, the loader imports the primary locale chunk.

This strategy increases the number of output files and the total delivery size in proportion to the number of locales. Prefer `virtual` when the application has many locales.

Related API:

- [`VueInternationalizationOptions`](../api.md#vueinternationalizationoptions)
- [`vueInternationalization()`](../api.md#vueinternationalization)
- [`createInternationalization()`](../api.md#createinternationalization)
