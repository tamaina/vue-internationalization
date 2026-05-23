import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { scanVueFiles } from '../src/files.js';
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
						scan: {
							include: 'src/**/*.vue',
							exclude: ['src/legacy/**'],
						},
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
			scan: {
				include: 'src/**/*.vue',
				exclude: ['src/legacy/**'],
			},
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

	it('scans Vue files with include and exclude patterns', () => {
		const root = mkdtempSync(join(tmpdir(), 'vue-internationalization-'));
		mkdirSync(join(root, 'src/features'), { recursive: true });
		mkdirSync(join(root, 'src/legacy'), { recursive: true });
		mkdirSync(join(root, 'docs'), { recursive: true });
		writeFileSync(join(root, 'src/App.vue'), '<template />');
		writeFileSync(join(root, 'src/features/Panel.vue'), '<template />');
		writeFileSync(join(root, 'src/legacy/Old.vue'), '<template />');
		writeFileSync(join(root, 'docs/Example.vue'), '<template />');

		expect(scanVueFiles(root, {
			include: 'src/**/*.vue',
			exclude: ['src/legacy/**'],
		}).map((file) => file.replace(root, ''))).toEqual([
			'/src/App.vue',
			'/src/features/Panel.vue',
		]);
	});

	it('loads env dictionaries from globbed yaml files with duplicate warnings', () => {
		const root = mkdtempSync(join(tmpdir(), 'vue-internationalization-'));
		mkdirSync(join(root, 'src/locales/ja-JP'), { recursive: true });
		writeFileSync(join(root, 'src/locales/ja-JP/base.yaml'), [
			'fuga: base',
			'nested:',
			'  title: base title',
		].join('\n'));
		writeFileSync(join(root, 'src/locales/ja-JP/override.yaml'), [
			'fuga: override',
			'nested:',
			'  body: override body',
		].join('\n'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		try {
			expect(internals.loadLocaleEnvDictionary(root, 'ja-JP', './src/locales/ja-JP/*.yaml')).toEqual({
				fuga: 'override',
				nested: {
					title: 'base title',
					body: 'override body',
				},
			});
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate env key "fuga"'));
		} finally {
			warn.mockRestore();
		}
	});

	it('rejects env dictionary paths outside the project root', () => {
		const root = mkdtempSync(join(tmpdir(), 'vue-internationalization-'));

		expect(() => internals.loadLocaleEnvDictionary(root, 'ja-JP', '../outside.yaml')).toThrow('must resolve inside');
	});

	it('rejects unsafe locale dictionary keys', () => {
		const root = mkdtempSync(join(tmpdir(), 'vue-internationalization-'));
		mkdirSync(join(root, 'src/locales'), { recursive: true });
		writeFileSync(join(root, 'src/locales/ja-JP.yaml'), [
			'safe: ok',
			'constructor:',
			'  polluted: true',
		].join('\n'));

		expect(() => internals.loadLocaleEnvDictionary(root, 'ja-JP', './src/locales/ja-JP.yaml')).toThrow('unsafe locale key "constructor"');
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
			'const title = l.sfc.title;',
			'const refTitle = l.value.sfc.title;',
			'const globalMessage = l.env.fuga;',
			'const refGlobalMessage = l.value.env.fuga;',
			'const primaryFallback = l.sfc.missingPrimary;',
			'const missing = l.sfc.missing;',
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
		expect(replaced).toContain('const missing = "$locale.sfc.missing";');
	});

	it('replaces script localizer calls from inline localizer bindings', () => {
		const marker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue');
		const binding = marker.match(/const \$l = (.*);/)?.[1];
		const code = [
			`const l = ${binding};`,
			'const apples = l.sfc.nApples({ n });',
			'const refApples = l.value.sfc.nApples({ n: count });',
			'const missing = l.sfc.missing({ n });',
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
		expect(replaced).toContain('const missing = "$locale.sfc.missing";');
	});

	it('rewrites template locale access to inline text markers', () => {
		const code = internals.rewriteInlineLocaleTemplateAccess(
			'<template><p>{{ $locale.sfc.title }}</p><p>{{ $locale.env.missing }}</p><p>{{ $l.sfc.nApples({ n }) }}</p></template>',
			'/src/App.vue',
		);

		expect(code).toContain('__VUE_INTERNATIONALIZATION_INLINE_TEXT__');
		expect(code).toContain('__VUE_INTERNATIONALIZATION_INLINE_LOCALIZER__');
		expect(code).toContain('"sfc.title"');
		expect(code).toContain('"env.missing"');
		expect(code).toContain('"sfc.nApples"');
	});

	it('replaces template inline text markers with primary and key-path fallback', () => {
		const marker = internals.rewriteInlineLocaleTemplateAccess(
			'<template>{{ $locale.sfc.title }} {{ $locale.sfc.missing }}</template>',
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
		expect(replaced).toContain('"$locale.sfc.missing"');
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
		expect(bundle['assets/App.ja-JP.js'].code).toContain('__locale.value = __locale');
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

	it('rewrites html entry script to an external locale loader', () => {
		const bundle: Record<string, {
			type: string;
			fileName: string;
			source: string;
		}> = {
			'index.html': {
				type: 'asset',
				fileName: 'index.html',
				source: '<div id="app"></div><script type="module" nonce="abc" crossorigin integrity="sha256-old" src="/assets/App-abc.js"></script>',
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

		expect(bundle['index.html'].source).toContain('src="/assets/App-abc.i18n-loader.js"');
		expect(bundle['index.html'].source).toContain('nonce="abc"');
		expect(bundle['index.html'].source).toContain('crossorigin');
		expect(bundle['index.html'].source).not.toContain('integrity=');
		expect(bundle['assets/App-abc.i18n-loader.js'].source).toContain('searchParams.get("locale")');
		expect(bundle['assets/App-abc.i18n-loader.js'].source).toContain('"/assets/App-abc.en-US.js"');
		expect(bundle['index.html'].source).not.toContain('src="/assets/App-abc.js"');
	});

	it('rewrites an html string with the external locale loader', () => {
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

		expect(html).toContain('src="/assets/App-abc.i18n-loader.js"');
		expect(html).toContain('crossorigin');
		expect(html).not.toContain('__vueInternationalizationLocale');
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
