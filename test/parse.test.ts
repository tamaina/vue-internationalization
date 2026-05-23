import { describe, expect, it } from 'vitest';
import { injectLocaleBinding, parseLocaleDictionary, stripLocaleBlocks, transformVueSfc } from '../src/parse.js';

describe('locale SFC parsing', () => {
	it('parses yaml dictionaries', () => {
		expect(parseLocaleDictionary('hoge: ほげ\nnested:\n  value: ok', 'yaml', 'fixture')).toEqual({
			hoge: 'ほげ',
			nested: {
				value: 'ok',
			},
		});
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

	it('injects localizer argument types from template placeholders', () => {
		const input = [
			'<script setup lang="ts">',
			'const x = 1;',
			'</script>',
			'<locale locale="ja-JP" lang="yaml">',
			'count: "{n} 個"',
			'mixed: "{name}: {count}"',
			'</locale>',
		].join('\n');

		const output = transformVueSfc(input, '/repo/src/App.vue');

		expect(output).toContain('count: (values: { n: import("vue-internationalization/runtime").LocaleTemplateValue; }) => string;');
		expect(output).toContain('mixed: (values: { name: import("vue-internationalization/runtime").LocaleTemplateValue; count: import("vue-internationalization/runtime").LocaleTemplateValue; }) => string;');
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
