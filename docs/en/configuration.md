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
        "buildStrategy": "virtual"
      }
    ]
  }
}
```

See the generated [API Reference](../api.md#vueinternationalizationoptions) for the full `VueInternationalizationOptions` type.

Related API:

- [`VueInternationalizationOptions`](../api.md#vueinternationalizationoptions)
- [`vueInternationalization()`](../api.md#vueinternationalization)
- [`LocaleMessages`](../api.md#localemessages)

Next:

- Choose `messageSyntax` in [Message Syntax](./message-syntax.md)
- Define `<locale>` blocks and global dictionaries in [Messages](./messages.md)
- Choose `buildStrategy` in [Build Strategy](./build-strategy.md)
