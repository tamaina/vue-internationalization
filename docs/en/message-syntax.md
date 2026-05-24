# Message Syntax

[`messageSyntax`](./configuration.md) is selected per project. Mixing `vue` and `icu` syntax per dictionary is not supported.

## Vue syntax

`vue` syntax is a lightweight format close to [vue-i18n message format syntax](https://vue-i18n.intlify.dev/guide/essentials/syntax).

```yaml
named: "Hello {user-name}"
list: "{0} and {1} translations"
plural: "no apples | one apple | {count} apples"
target: "linked message"
linked: "@.capitalize:target"
```

## ICU syntax

`icu` syntax is handled by [FormatJS ICU Message syntax](https://formatjs.github.io/docs/core-concepts/icu-syntax/).

```yaml
hello: "Hello {name}"
apples: "{count, plural, =0 {No apples} one {One apple} other {# apples}}"
```

Related API:

- [`formatLocaleMessage()`](../api.md#formatlocalemessage)
- [`getLocaleMessageNamedKeys()`](../api.md#getlocalemessagenamedkeys)
- [`getLocaleMessageListIndexes()`](../api.md#getlocalemessagelistindexes)
- [`hasLocaleMessagePlural()`](../api.md#haslocalemessageplural)
- [`LocaleMessageSyntax`](../api.md#localemessagesyntax)
