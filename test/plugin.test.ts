import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { internals } from '../src/plugin.js';

describe('virtual module generation', () => {
	it('resolves plugin options from tsconfig vueCompilerOptions', () => {
		const root = mkdtempSync(join(tmpdir(), 'vue-internationalization-'));
		writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
			vueCompilerOptions: {
				plugins: [
					{
						name: 'vue-internationalization/volar',
						primaryLocale: 'ja-JP',
						buildStrategy: 'inline-chunks',
						global: {
							'ja-JP': './src/locales/ja-JP.yaml',
						},
					},
				],
			},
		}));

		expect(internals.resolveOptions(root, {})).toEqual({
			primaryLocale: 'ja-JP',
			buildStrategy: 'inline-chunks',
			global: {
				'ja-JP': './src/locales/ja-JP.yaml',
			},
		});
	});

	it('resolves plugin options from jsonc tsconfig', () => {
		const root = mkdtempSync(join(tmpdir(), 'vue-internationalization-'));
		writeFileSync(join(root, 'tsconfig.json'), `{
			// Vue Language Tools reads this block.
			"vueCompilerOptions": {
				"plugins": [
					{
						"name": "vue-internationalization/volar",
						"primaryLocale": "ja-JP",
					},
				],
			},
		}`);

		expect(internals.resolveOptions(root, {})).toEqual({
			primaryLocale: 'ja-JP',
			buildStrategy: undefined,
			global: undefined,
		});
	});

	it('prefers explicit Vite plugin options over tsconfig values', () => {
		const root = mkdtempSync(join(tmpdir(), 'vue-internationalization-'));
		writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
			vueCompilerOptions: {
				plugins: [
					{
						name: 'vue-internationalization/volar',
						primaryLocale: 'ja-JP',
					},
				],
			},
		}));

		expect(internals.resolveOptions(root, {
			primaryLocale: 'en-US',
		})).toEqual({
			primaryLocale: 'en-US',
			buildStrategy: undefined,
			global: undefined,
		});
	});

	it('generates dynamic locale loaders for chunk splitting', () => {
		const code = internals.generateRuntimeModule('ja-JP', ['en-US', 'ja-JP']);

		expect(code).toContain('() => import("virtual:vue-internationalization/locale/en-US")');
		expect(code).toContain('primaryLocale = "ja-JP"');
		expect(code).toContain('export const currentLocale = resolveInitialLocale();');
	});

	it('generates inline build runtime without dynamic locale imports', () => {
		const code = internals.generateInlineRuntimeModule('ja-JP', ['en-US', 'ja-JP']);

		expect(code).not.toContain('import("virtual:vue-internationalization/locale/');
		expect(code).toContain('Promise.resolve({ global: {}, modules: {} })');
		expect(code).toContain('export const currentLocale = resolveInitialLocale();');
		expect(code).not.toContain('onLocaleChange');
	});

	it('generates locale-specific payload modules', () => {
		const code = internals.generateLocaleModule(
			'en-US',
			{
				'/repo/src/App.vue': {
					'en-US': {
						hoge: 'foo',
					},
					'ja-JP': {
						hoge: 'ほげ',
					},
				},
			},
			{
				'en-US': {
					fuga: 'bar',
				},
			},
		);

		expect(code).toContain('"hoge":"foo"');
		expect(code).toContain('"fuga":"bar"');
		expect(code).not.toContain('ほげ');
	});

	it('duplicates inline chunks per locale and replaces locale markers', () => {
		const marker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue');
		const code = marker.match(/const \$locale = (.*);/)?.[1];
		const chunk = {
			type: 'chunk',
			fileName: 'assets/App-abc.js',
			code: `const msg = ${code};`,
			imports: [],
			dynamicImports: [],
			facadeModuleId: null,
			isDynamicEntry: false,
			isEntry: true,
			isImplicitEntry: false,
			moduleIds: [],
			modules: {},
			name: 'App',
			preliminaryFileName: 'assets/App-abc.js',
			referencedFiles: [],
		};
		const bundle: Record<string, {
			type: string;
			fileName: string;
			code: string;
			imports: string[];
			dynamicImports: string[];
		}> = {
			[chunk.fileName]: chunk,
		};

		internals.inlineLocaleChunks(
			bundle,
			['en-US', 'ja-JP'],
			'ja-JP',
			{
				'/src/App.vue': {
					'ja-JP': { title: 'ほげ' },
					'en-US': { title: 'foo' },
				},
			},
			{},
		);

		expect(bundle['assets/App-abc.ja-JP.js'].type).toBe('chunk');
		expect(bundle['assets/App-abc.ja-JP.js'].code).toContain('"title":"ほげ"');
		expect(bundle['assets/App-abc.en-US.js'].code).toContain('"title":"foo"');
	});

	it('replaces script member access from inline locale bindings', () => {
		const marker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue');
		const binding = marker.match(/const \$locale = (.*);/)?.[1];
		const code = [
			`const l = ${binding};`,
			'const title = l.module.title;',
			'const refTitle = l.value.module.title;',
			'const globalMessage = l.global.fuga;',
			'const refGlobalMessage = l.value.global.fuga;',
			'const primaryFallback = l.module.missingPrimary;',
			'const missing = l.module.missing;',
		].join('');

		const replaced = internals.replaceInlineLocaleMemberAccess(
			code,
			'en-US',
			'ja-JP',
			{
				'/src/App.vue': {
					'en-US': {
						title: 'foo',
					},
					'ja-JP': {
						missingPrimary: 'primary',
					},
				},
			},
			{
				'en-US': {
					fuga: 'bar',
				},
			},
		);

		expect(replaced).toContain('const title = "foo";');
		expect(replaced).toContain('const refTitle = "foo";');
		expect(replaced).toContain('const globalMessage = "bar";');
		expect(replaced).toContain('const refGlobalMessage = "bar";');
		expect(replaced).toContain('const primaryFallback = "primary";');
		expect(replaced).toContain('const missing = "$locale.module.missing";');
	});

	it('replaces script localizer calls from inline localizer bindings', () => {
		const marker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue');
		const binding = marker.match(/const \$l = (.*);/)?.[1];
		const code = [
			`const l = ${binding};`,
			'const apples = l.module.nApples({ n });',
			'const refApples = l.value.module.nApples({ n: count });',
			'const missing = l.module.missing({ n });',
		].join('');

		const replaced = internals.replaceInlineLocalizerAccess(
			code,
			'en-US',
			'ja-JP',
			{
				'/src/App.vue': {
					'en-US': {
						nApples: '{n} apples',
					},
					'ja-JP': {
						nApples: '{n} 個のりんご',
					},
				},
			},
			{},
		);

		expect(replaced).toContain('const apples = ((__values) => (__values.n == null ? "{n}" : __values.n) + " apples")({ n });');
		expect(replaced).toContain('const refApples = ((__values) => (__values.n == null ? "{n}" : __values.n) + " apples")({ n: count });');
		expect(replaced).toContain('const missing = "$locale.module.missing";');
	});

	it('rewrites template locale access to inline text markers', () => {
		const code = internals.rewriteInlineLocaleTemplateAccess(
			'<template><p>{{ $locale.module.title }}</p><p>{{ $locale.global.missing }}</p><p>{{ $l.module.nApples({ n }) }}</p></template>',
			'/src/App.vue',
		);

		expect(code).toContain('__VUE_INTERNATIONALIZATION_INLINE_TEXT__');
		expect(code).toContain('__VUE_INTERNATIONALIZATION_INLINE_LOCALIZER__');
		expect(code).toContain('"module.title"');
		expect(code).toContain('"global.missing"');
		expect(code).toContain('"module.nApples"');
	});

	it('replaces template inline text markers with primary and key-path fallback', () => {
		const marker = internals.rewriteInlineLocaleTemplateAccess(
			'<template>{{ $locale.module.title }} {{ $locale.module.missing }}</template>',
			'/src/App.vue',
		);
		const replaced = internals.replaceInlineLocaleTextAccess(
			marker,
			'en-US',
			'ja-JP',
			{
				'/src/App.vue': {
					'ja-JP': {
						title: 'ほげ',
					},
				},
			},
			{},
		);

		expect(replaced).toContain('"ほげ"');
		expect(replaced).toContain('"$locale.module.missing"');
	});

	it('keeps object replacement as a fallback for template scope', () => {
		const marker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue');
		const binding = marker.match(/const \$locale = (.*);/)?.[1];
		const code = `const l = ${binding};`;

		const replaced = internals.replaceInlineLocaleMemberAccess(
			code,
			'ja-JP',
			'ja-JP',
			{
				'/src/App.vue': {
					'ja-JP': {
						title: 'ほげ',
					},
				},
			},
			{},
		);

		expect(replaced).toContain('const l = __VUE_INTERNATIONALIZATION_INLINE_LOCALE__');
	});

	it('replaces inline localizer objects as a fallback for dynamic access', () => {
		const marker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue');
		const binding = marker.match(/const \$l = (.*);/)?.[1];
		const code = `const l = ${binding};`;
		const bundle: Record<string, {
			type: string;
			fileName: string;
			code: string;
			imports: string[];
			dynamicImports: string[];
		}> = {
			'assets/App.js': {
				type: 'chunk',
				fileName: 'assets/App.js',
				code,
				imports: [],
				dynamicImports: [],
			},
		};

		const manifest = internals.inlineLocaleChunks(
			bundle,
			['ja-JP'],
			'ja-JP',
			{
				'/src/App.vue': {
					'ja-JP': {
						nApples: '{n} 個のりんご',
					},
				},
			},
			{},
		);

		expect(manifest.entries).toHaveLength(1);
		expect(bundle['assets/App.ja-JP.js'].code).toContain('nApples:(values = {}) => ((__values) =>');
		expect(bundle['assets/App.ja-JP.js'].code).not.toContain('__VUE_INTERNATIONALIZATION_INLINE_LOCALIZERS__');
	});

	it('rewrites imports between localized chunks', () => {
		const appMarker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue');
		const childMarker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/AsyncPanel.vue');
		const appCode = appMarker.match(/const \$locale = (.*);/)?.[1];
		const childCode = childMarker.match(/const \$locale = (.*);/)?.[1];
		const bundle: Record<string, {
			type: string;
			fileName: string;
			code: string;
			imports: string[];
			dynamicImports: string[];
		}> = {
			'assets/App.js': {
				type: 'chunk',
				fileName: 'assets/App.js',
				code: `const msg = ${appCode}; import("./AsyncPanel.js");`,
				imports: [],
				dynamicImports: ['assets/AsyncPanel.js'],
			},
			'assets/AsyncPanel.js': {
				type: 'chunk',
				fileName: 'assets/AsyncPanel.js',
				code: `const msg = ${childCode};`,
				imports: [],
				dynamicImports: [],
			},
		};

		internals.inlineLocaleChunks(
			bundle,
			['en-US', 'ja-JP'],
			'ja-JP',
			{
				'/src/App.vue': {
					'ja-JP': { title: '親' },
					'en-US': { title: 'Parent' },
				},
				'/src/AsyncPanel.vue': {
					'ja-JP': { title: '子' },
					'en-US': { title: 'Child' },
				},
			},
			{},
		);

		expect(bundle['assets/App.ja-JP.js'].dynamicImports).toEqual(['assets/AsyncPanel.ja-JP.js']);
		expect(bundle['assets/App.en-US.js'].dynamicImports).toEqual(['assets/AsyncPanel.en-US.js']);
		expect(bundle['assets/App.ja-JP.js'].code).toContain('./AsyncPanel.ja-JP.js');
		expect(bundle['assets/App.en-US.js'].code).toContain('./AsyncPanel.en-US.js');
	});

	it('rewrites html entry script to select a localized chunk from the locale query', () => {
		const bundle = {
			'index.html': {
				type: 'asset',
				fileName: 'index.html',
				source: '<div id="app"></div><script type="module" crossorigin src="/assets/App-abc.js"></script>',
			},
		};

		internals.inlineLocaleHtml(bundle, {
			primaryLocale: 'ja-JP',
			entries: [
				{
					fileName: 'assets/App-abc.ja-JP.js',
					originalFileName: 'assets/App-abc.js',
					locales: {
						'ja-JP': 'assets/App-abc.ja-JP.js',
						'en-US': 'assets/App-abc.en-US.js',
					},
				},
			],
		});

		expect(bundle['index.html'].source).toContain('searchParams.get("locale")');
		expect(bundle['index.html'].source).toContain('"/assets/App-abc.en-US.js"');
		expect(bundle['index.html'].source).not.toContain('src="/assets/App-abc.js"');
	});

	it('rewrites an html string with the inline chunk selector', () => {
		const html = internals.replaceInlineLocaleHtml(
			'<script type="module" crossorigin src="/assets/App-abc.js"></script>',
			{
				primaryLocale: 'ja-JP',
				entries: [
					{
						fileName: 'assets/App-abc.ja-JP.js',
						originalFileName: 'assets/App-abc.js',
						locales: {
							'ja-JP': 'assets/App-abc.ja-JP.js',
							'en-US': 'assets/App-abc.en-US.js',
						},
					},
				],
			},
		);

		expect(html).toContain('import(__vueInternationalizationEntries[__vueInternationalizationLocale]');
	});

	it('augments vite manifest with localized chunks', () => {
		const manifest = internals.augmentViteManifestJson(
			JSON.stringify({
				'index.html': {
					file: 'assets/App-abc.en-US.js',
					name: 'index',
					src: 'index.html',
					isEntry: true,
				},
			}),
			{
				primaryLocale: 'ja-JP',
				entries: [
					{
						fileName: 'assets/App-abc.ja-JP.js',
						originalFileName: 'assets/App-abc.js',
						locales: {
							'ja-JP': 'assets/App-abc.ja-JP.js',
							'en-US': 'assets/App-abc.en-US.js',
						},
					},
				],
			},
		);
		const parsed = JSON.parse(manifest);

		expect(parsed['index.html'].file).toBe('assets/App-abc.ja-JP.js');
		expect(parsed['index.html'].locale).toBe('ja-JP');
		expect(parsed['index.html'].internationalization.locales['en-US']).toBe('assets/App-abc.en-US.js');
		expect(parsed['index.html?locale=en-US'].file).toBe('assets/App-abc.en-US.js');
		expect(parsed['index.html?locale=en-US'].locale).toBe('en-US');
	});
});
