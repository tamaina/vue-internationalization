import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createParsedCommandLine, createVueLanguagePlugin, forEachEmbeddedCode, getDefaultCompilerOptions } from '@vue/language-core';
import vueInternationalizationVolar from '../src/volar.js';

const require = createRequire(import.meta.url);

describe('volar plugin', () => {
	it('can be loaded from vueCompilerOptions.plugins via require export', () => {
		const parsed = createParsedCommandLine(ts, {
			fileExists: ts.sys.fileExists,
			readFile: ts.sys.readFile,
			useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
		}, 'examples/motivation-1/tsconfig.json');

		expect(parsed.vueOptions.plugins.some((plugin) =>
			(plugin as { __moduleConfig?: { name?: string } }).__moduleConfig?.name === 'vue-internationalization/volar',
		)).toBe(true);
	});

	it('injects $l through the CommonJS Volar entry used by Vue Language Tools', () => {
		const vueCompilerOptions = getDefaultCompilerOptions();
		vueCompilerOptions.plugins = [
			withConfig(require('../src/volar.cjs') as typeof vueInternationalizationVolar, {
				__moduleConfig: {
					name: 'vue-internationalization/volar',
					primaryLocale: 'ja-JP',
				},
			}),
		];
		const plugin = createVueLanguagePlugin(ts, {}, vueCompilerOptions, String);
		const fileName = resolve('examples/motivation-1/src/App.vue');
		const source = [
			'<template>{{ $l.module.count({ n: 1 }) }}</template>',
			'<locale locale="ja-JP" lang="yaml">',
			'count: "{n} 個"',
			'</locale>',
		].join('\n');
		const root = plugin.createVirtualCode?.(fileName, 'vue', ts.ScriptSnapshot.fromString(source), {} as never);

		if (!root) {
			throw new Error('Expected Vue virtual code to be created.');
		}

		const scriptCode = [...forEachEmbeddedCode(root)]
			.find((code) => code.id === 'script_ts')
			?.snapshot.getText(0, Number.MAX_SAFE_INTEGER);

		expect(scriptCode).toContain('declare const $l: Readonly<import("vue").ComputedRef');
		expect(scriptCode).toContain('__VLS_ctx.$l.module.count');
	});

	it('injects file-local setup bindings into Vue virtual code', () => {
		const vueCompilerOptions = getDefaultCompilerOptions();
		vueCompilerOptions.plugins = [
			withConfig(vueInternationalizationVolar, {
				__moduleConfig: {
					name: 'vue-internationalization/volar',
					primaryLocale: 'ja-JP',
					global: {
						'ja-JP': {
							fuga: 'bar',
						},
					},
				},
			}),
		];
		const plugin = createVueLanguagePlugin(ts, {}, vueCompilerOptions, String);
		const fileName = resolve('examples/motivation-1/src/App.vue');
		const source = [
			'<template>{{ $locale.module.hoge }} {{ $locale.global.fuga }} {{ $l.module.count({ n: 1 }) }}</template>',
			'<script setup lang="ts">',
			'const title = $locale.value.module.hoge;',
			'const count = $l.value.module.count({ n: 1 });',
			'</script>',
			'<locale locale="ja-JP" lang="yaml">',
			'hoge: ほげ',
			'count: "{n} 個"',
			'</locale>',
		].join('\n');
		const root = plugin.createVirtualCode?.(fileName, 'vue', ts.ScriptSnapshot.fromString(source), {} as never);

		if (!root) {
			throw new Error('Expected Vue virtual code to be created.');
		}

		const scriptCode = [...forEachEmbeddedCode(root)]
			.find((code) => code.id === 'script_ts')
			?.snapshot.getText(0, Number.MAX_SAFE_INTEGER);
		const scriptSetupRaw = [...forEachEmbeddedCode(root)]
			.find((code) => code.id === 'scriptsetup_raw')
			?.snapshot.getText(0, Number.MAX_SAFE_INTEGER);

		expect(scriptCode).not.toContain('interface ComponentCustomProperties');
		expect(scriptCode).toContain('declare const $locale: Readonly<import("vue").ComputedRef<import("vue-internationalization/runtime").LocaleScope<');
		expect(scriptCode).toContain('{ hoge: string; count: string; }>>>');
		expect(scriptCode).toContain('declare const $l: Readonly<import("vue").ComputedRef<{ global:');
		expect(scriptCode).toContain('module: { hoge: import("vue-internationalization/runtime").LocaleTemplateFunction; count: import("vue-internationalization/runtime").LocaleTemplateFunction; }; }>>');
		expect(scriptCode).toContain('ComponentPublicInstance & { $locale: import("vue-internationalization/runtime").LocaleScope<');
		expect(scriptCode).toContain('$l: { global:');
		expect(scriptCode).toContain('__VLS_ctx.$locale.module.hoge');
		expect(scriptCode).toContain('__VLS_ctx.$l.module.count');
		expect(scriptSetupRaw?.trim()).toBe('const title = $locale.value.module.hoge;\nconst count = $l.value.module.count({ n: 1 });');
	});
});

function withConfig(
	plugin: typeof vueInternationalizationVolar,
	config: { __moduleConfig: Record<string, unknown> },
): typeof vueInternationalizationVolar {
	const wrapped: typeof vueInternationalizationVolar = (context) => plugin(context);
	return Object.assign(wrapped, config);
}
