# Build Strategy

[`buildStrategy`](./configuration.md) controls how locale payloads are reflected in the built bundle.

## `virtual`

The default strategy. Locale modules are loaded through dynamic `import()` calls so [Vite build](https://vite.dev/guide/build.html) can split locale chunks.

## `inline-chunks`

Build-time strategy that duplicates localizable chunks per locale and replaces `$locale` / `$l` references with locale-specific string literals, dictionary objects, or message formatting expressions.

Each locale, including the primary locale, is emitted as a locale-specific chunk such as `*.ja-JP.js` or `*.en-US.js`. The HTML entry script is replaced with a `*.i18n-loader.js` loader, which reads the `locale` query parameter and imports the matching locale chunk. When `locale` is missing or unsupported, the loader imports the primary locale chunk.

The rewritten `<script>` keeps existing attributes such as `nonce`, `crossorigin`, and `referrerpolicy`. When the original entry script has `integrity`, it is replaced with integrity for the generated loader. The loader verifies the selected locale chunk with `modulepreload` and per-locale chunk integrity before calling `import()`.

### References That Cannot Be Fully Inlined

Static references such as `$locale.sfc.title`, `$locale.env.title`, and `$l.sfc.count({ n })` are replaced with locale-specific string literals or message formatting expressions. References that become dynamic after a static prefix, such as `$locale.env.labels[key]`, embed the resolved locale-specific subtree and keep a runtime lookup expression.

Paths that cannot be resolved at build time and `$l` calls that are too complex fall back to the primary locale value. If the primary locale is also missing the value, the expression returns a key string such as `$locale.sfc.missingKey`. JavaScript that cannot be parsed during replacement fails the build instead of being left silently unprocessed.

This strategy increases the number of output files and the total delivery size in proportion to the number of locales. Prefer `virtual` when the application has many locales.

Related API:

- [`VueInternationalizationOptions`](../api.md#vueinternationalizationoptions)
- [`vueInternationalization()`](../api.md#vueinternationalization)
- [`createInternationalization()`](../api.md#createinternationalization)
