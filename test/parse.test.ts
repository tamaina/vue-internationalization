import { describe, expect, it } from 'vitest';
import { injectLocaleBinding, parseLocaleDictionary, parseLocaleDictionaryForDiagnostics, parseScriptLocaleDictionaries, stripLocaleBlocks, transformVueSfc } from '../src/parse.js';

describe('locale SFC parsing', () => {
	it('parses yaml dictionaries', () => {
		expect(parseLocaleDictionary('hoge: ほげ\nnested:\n  value: ok', 'yaml', 'fixture')).toEqual({
			hoge: 'ほげ',
			nested: {
				value: 'ok',
			},
		});
	});

	it('returns diagnostics for invalid locale dictionaries without throwing', () => {
		expect(parseLocaleDictionaryForDiagnostics('broken: [', 'yaml', 'fixture').diagnostics[0]?.message).toContain('Failed to parse fixture:');
		expect(parseLocaleDictionaryForDiagnostics('{ "broken": }', 'json', 'fixture').diagnostics[0]?.message).toContain('Failed to parse fixture:');
		expect(parseLocaleDictionaryForDiagnostics('- array', 'yaml', 'fixture').diagnostics[0]?.message).toContain('fixture must contain an object at the top level.');
		expect(parseLocaleDictionaryForDiagnostics('constructor: unsafe', 'yaml', 'fixture').diagnostics[0]?.message).toContain('fixture contains unsafe locale key "constructor".');
		expect(parseLocaleDictionaryForDiagnostics('x = 1', 'toml', 'fixture').diagnostics[0]?.message).toBe('Unsupported locale lang "toml" in fixture. Use yaml, yml, or json.');
	});

	it('strips locale blocks and injects a setup binding', () => {
		const input = [
			'<script setup lang="ts">',
			'const x = 1;',
			'</script>',
			'<template>{{ $locale.sfc.hoge }}</template>',
			'<locale locale="ja-JP" lang="yaml">',
			'hoge: ほげ',
			'</locale>',
		].join('\n');

		const output = transformVueSfc(input, '/repo/src/App.vue');

		expect(output).toContain('const $locale = __useLocale<{}, { hoge: string; }>(import.meta.url);');
		expect(output).toContain('const $l = __useLocalizer(import.meta.url) as Readonly<import("vue").ComputedRef<{ env: import("vue-internationalization/runtime").LocaleLocalizerDictionary; sfc: { hoge: () => string; }; }>>;');
		expect(output).not.toContain('<locale');
		expect(output).toContain('const x = 1;');
	});

	it('injects primary locale dictionary types into TypeScript setup bindings', () => {
		const input = [
			'<script setup lang="ts">',
			'const x = 1;',
			'</script>',
			'<template>{{ $locale.sfc.hoge }}</template>',
			'<locale locale="ja-JP" lang="yaml">',
			'hoge: ほげ',
			'nested:',
			'  count: 1',
			'</locale>',
			'<locale locale="en-US" lang="yaml">',
			'hoge: foo',
			'</locale>',
		].join('\n');

		const output = transformVueSfc(input, '/repo/src/App.vue', {
			primaryLocale: 'ja-JP',
			global: {
				fuga: 'bar',
			},
		});

		expect(output).toContain('const $locale = __useLocale<{ fuga: string; }, { hoge: string; nested: { count: number; }; }>');
		expect(output).toContain('const $l = __useLocalizer(import.meta.url) as Readonly<import("vue").ComputedRef<{ env: { fuga: () => string; }; sfc: { hoge: () => string; nested: { count: () => string; }; }; }>>;');
	});

	it('merges multiple blocks for the primary locale with later blocks taking precedence', () => {
		const input = [
			'<script setup lang="ts">',
			'const x = 1;',
			'</script>',
			'<locale locale="ja-JP" lang="yaml">',
			'title: 古いタイトル',
			'nested:',
			'  first: 1',
			'  overwrite: old',
			'</locale>',
			'<locale locale="en-US" lang="yaml">',
			'title: Title',
			'</locale>',
			'<locale locale="ja-JP" lang="yaml">',
			'title: 新しいタイトル',
			'nested:',
			'  second: 2',
			'  overwrite: new',
			'</locale>',
		].join('\n');

		const output = transformVueSfc(input, '/repo/src/App.vue', {
			primaryLocale: 'ja-JP',
		});

		expect(output).toContain('const $locale = __useLocale<{}, { title: string; nested: { first: number; overwrite: string; second: number; }; }>');
		expect(output).not.toContain('古いタイトル');
		expect(output).not.toContain('新しいタイトル');
	});

	it('injects localizer argument types from template placeholders', () => {
		const input = [
			'<script setup lang="ts">',
			'const x = 1;',
			'</script>',
			'<locale locale="ja-JP" lang="yaml">',
			'count: "{n} 個"',
			'mixed: "{name}: {count}"',
			'kebab: "{user-name}"',
			'plural: "car | cars"',
			'</locale>',
		].join('\n');

		const output = transformVueSfc(input, '/repo/src/App.vue');

		expect(output).toContain('count: (values: { n: import("vue-internationalization/runtime").LocaleTemplateValue; }) => string;');
		expect(output).toContain('mixed: (values: { name: import("vue-internationalization/runtime").LocaleTemplateValue; count: import("vue-internationalization/runtime").LocaleTemplateValue; }) => string;');
		expect(output).toContain('"user-name": import("vue-internationalization/runtime").LocaleTemplateValue;');
		expect(output).toContain('plural: (plural: number) => string;');
	});

	it('injects localizer argument types from ICU MessageFormat placeholders in ICU mode', () => {
		const input = [
			'<script setup lang="ts">',
			'</script>',
			'<locale locale="ja-JP" lang="yaml">',
			'icu: "{count, plural, one {one car} other {# cars by {name}}}"',
			'</locale>',
		].join('\n');

		const output = transformVueSfc(input, '/repo/src/App.vue', {
			messageSyntax: 'icu',
		});

		expect(output).toContain('icu: (values: { count: import("vue-internationalization/runtime").LocaleTemplateValue; name: import("vue-internationalization/runtime").LocaleTemplateValue; }) => string;');
	});

	it('preserves message function types in injected localizer bindings', () => {
		const input = [
			'<script setup lang="ts">',
			'</script>',
			'<locale locale="ja-JP" lang="yaml">',
			'title: ほげ',
			'</locale>',
		].join('\n');

		const output = transformVueSfc(input, '/repo/src/App.vue', {
			primaryLocale: 'ja-JP',
			global: {
				greeting: () => 'Hello',
			},
		});

		expect(output).toContain('env: { greeting: import("vue-internationalization/runtime").LocaleMessageFunction; };');
	});

	it('extracts script-defined locale messages', () => {
		const input = [
			'<script lang="ts">',
			'import { defineInternationalization } from "vue-internationalization";',
			'export const messages = defineInternationalization({',
			'  "ja-JP": {',
			'    title: "ほげ",',
			'    greeting: (values?: { name?: string }) => `こんにちは ${values?.name ?? "名無し"}`,',
			'  },',
			'});',
			'</script>',
		].join('\n');

		const dictionaries = parseScriptLocaleDictionaries(input, '/repo/src/App.vue');
		const output = transformVueSfc(input, '/repo/src/App.vue', {
			primaryLocale: 'ja-JP',
		});

		expect(dictionaries['ja-JP']?.title).toBe('ほげ');
		expect(String(dictionaries['ja-JP']?.greeting)).toContain('(values) =>');
		expect(output).toContain('sfc: { title: () => string; greeting: import("vue-internationalization/runtime").LocaleMessageFunction; };');
	});

	it('does not inject TypeScript type parameters into JavaScript setup blocks', () => {
		const input = [
			'<script setup>',
			'const x = 1;',
			'</script>',
			'<locale locale="ja-JP" lang="yaml">',
			'hoge: ほげ',
			'</locale>',
		].join('\n');

		const output = transformVueSfc(input, '/repo/src/App.vue', {
			primaryLocale: 'ja-JP',
		});

		expect(output).toContain('const $locale = __useLocale(import.meta.url);');
		expect(output).toContain('const $l = __useLocalizer(import.meta.url);');
		expect(output).not.toContain('__useLocale<');
	});

	it('creates script setup when a component has only template and locale blocks', () => {
		const stripped = stripLocaleBlocks('<template>ok</template><locale locale="ja-JP">ok: true</locale>', '/x.vue');
		const output = injectLocaleBinding(stripped);

		expect(output).toContain('<script setup lang="ts">');
		expect(output).toContain('virtual:vue-internationalization');
	});
});
