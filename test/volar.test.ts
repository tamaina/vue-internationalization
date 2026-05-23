import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createParsedCommandLine, createVueLanguagePlugin, forEachEmbeddedCode, getDefaultCompilerOptions } from '@vue/language-core';
import vueInternationalizationVolar from '../src/volar.js';

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
		expect(parsed.vueOptions.plugins.some((plugin) => typeof plugin === 'function')).toBe(true);
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
			'<template>{{ $locale.sfc.hoge }} {{ $locale.env.fuga }} {{ $l.sfc.count({ n: 1 }) }}',
			'<!-- @ts-expect-error: ts-plugin(2339) -->',
			'{{ $locale.sfc.noTranslation }}</template>',
			'<script setup lang="ts">',
			'const title = $locale.value.sfc.hoge;',
			'const count = $l.value.sfc.count({ n: 1 });',
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
		expect(scriptCode).toContain('{ hoge: "ほげ"; count: "{n} 個"; }>>>');
		expect(scriptCode).toContain('declare const $l: Readonly<import("vue").ComputedRef<{ env:');
		expect(scriptCode).toContain('* $l.sfc.count({ n })');
		expect(scriptCode).toContain('* $l.sfc.hoge()');
		expect(getQuickInfo(scriptCode, '__VLS_ctx.$l.sfc.count')).toEqual({
			documentation: 'Primary locale text:\n{n} 個',
			display: '(property) count: (values: {\n    n: import("vue-internationalization/runtime").LocaleTemplateValue;\n}) => string',
			tags: [
				'example: $l.sfc.count({ n })',
			],
		});
		expect(scriptCode).toContain('ComponentPublicInstance & { $locale: import("vue-internationalization/runtime").LocaleScope<');
		expect(scriptCode).toContain('$l: { env:');
		expect(scriptCode).toContain('__VLS_ctx.$locale.sfc.hoge');
		expect(scriptCode).toContain('__VLS_ctx.$l.sfc.count');
		expect(scriptCode).toContain('// @ts-expect-error: ts-plugin(2339)\n( __VLS_ctx.$locale.sfc.noTranslation );');
		expect(scriptSetupRaw?.trim()).toBe('const title = $locale.value.sfc.hoge;\nconst count = $l.value.sfc.count({ n: 1 });');
	});
});

function withConfig(
	plugin: typeof vueInternationalizationVolar,
	config: { __moduleConfig: Record<string, unknown> },
): typeof vueInternationalizationVolar {
	const wrapped: typeof vueInternationalizationVolar = (context) => plugin(context);
	return Object.assign(wrapped, config);
}

function getQuickInfo(source: string | undefined, needle: string): { documentation: string; display: string; tags: string[] } | undefined {
	if (!source) {
		return undefined;
	}

	const fileName = 'virtual.ts';
	const needleStart = source.indexOf(needle);
	const symbolStart = needleStart + needle.lastIndexOf('.') + 1;
	const languageService = ts.createLanguageService({
		getCompilationSettings: () => ({
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			strict: true,
			target: ts.ScriptTarget.ESNext,
		}),
		getCurrentDirectory: () => process.cwd(),
		getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
		getScriptFileNames: () => [fileName],
		getScriptSnapshot: (requestedFileName) => {
			if (requestedFileName === fileName) {
				return ts.ScriptSnapshot.fromString(source);
			}

			const fileContent = ts.sys.readFile(requestedFileName);
			return fileContent === undefined ? undefined : ts.ScriptSnapshot.fromString(fileContent);
		},
		getScriptVersion: () => '0',
		directoryExists: ts.sys.directoryExists,
		fileExists: ts.sys.fileExists,
		getDirectories: ts.sys.getDirectories,
		readDirectory: ts.sys.readDirectory,
		readFile: ts.sys.readFile,
		realpath: ts.sys.realpath,
	});

	const quickInfo = languageService.getQuickInfoAtPosition(fileName, symbolStart);
	return {
		documentation: ts.displayPartsToString(quickInfo?.documentation ?? []),
		display: ts.displayPartsToString(quickInfo?.displayParts ?? []),
		tags: quickInfo?.tags?.map((tag) => `${tag.name}: ${ts.displayPartsToString(tag.text ?? [])}`) ?? [],
	};
}
