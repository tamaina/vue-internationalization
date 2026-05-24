# Configuration
Configure it in `vueCompilerOptions.plugins` in the Vite root `tsconfig.json`, or pass it as an argument to the Vite plugin function (`vueInternationalization()`).

To get types in VS Code and `vue-tsc`, configuring it in the Vite root `tsconfig.json` is recommended.

```json
{
  "vueCompilerOptions": {
    "plugins": [
      {
        "name": "vite-vue-internationalization/volar",
        "primaryLocale": "en-US",
        "messageSyntax": "vue",
        "buildStrategy": "virtual",
        "sfcTransform": "locale-sources"
      }
    ]
  }
}
```

| Option | Default | Description |
| --- | --- | --- |
| `primaryLocale` | required | Locale used as the source for generated types. |
| `global` | `undefined` | Sources for global dictionaries keyed by locale. |
| `buildStrategy` | `virtual` | Choose `virtual` or `inline-chunks`. |
| `scan.include` | `**/*.vue` | Limits Vue files collected at startup. |
| `scan.exclude` | `[]` | Excludes Vue files from collection. |
| `messageSyntax` | `vue` | Choose `vue` or `icu` for the whole project. |
| `sfcTransform` | `locale-sources` | Controls which SFCs receive `$locale`/`$l` bindings. `locale-sources` transforms only SFCs with `<locale>` or `defineInternationalization()`, while `all` transforms every SFC. |
| `globalType` | `detailed` | Controls Volar types for `$locale.env` and `$l.env`. Use `runtime` for very large global dictionaries to avoid expanding every key during `vue-tsc`. |
| `localizerDocumentation` | `true` | Controls `$l` JSDoc generation for Volar hover text. |

Vite transform output uses broad runtime types for `$locale.env` and `$l.env` so large global dictionary types are not duplicated into every transformed SFC. Vue Language Tools / Volar uses detailed global dictionary types by default for editor completion and `vue-tsc`; set `globalType: "runtime"` when the global dictionary is too large for type checking.

See the generated [API Reference](../api.md#vueinternationalizationoptions) for the full `VueInternationalizationOptions` type.

Related API:

- [`VueInternationalizationOptions`](../api.md#vueinternationalizationoptions)
- [`vueInternationalization()`](../api.md#vueinternationalization)
- [`LocaleMessages`](../api.md#localemessages)

Next:

- Choose `messageSyntax` in [Message Syntax](./message-syntax.md)
- Define `<locale>` blocks and global dictionaries in [Messages](./messages.md)
- Choose `buildStrategy` in [Build Strategy](./build-strategy.md)
