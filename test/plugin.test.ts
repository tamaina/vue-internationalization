import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@vue/compiler-sfc';
import { scanVueFiles } from '../src/files.js';
import { internals } from '../src/plugin.js';

describe('virtual module generation', () => {
	it('resolves plugin options from tsconfig vueCompilerOptions', () => {
		const root = mkdtempSync(join(tmpdir(), 'vite-vue-internationalization-'));
		writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
			vueCompilerOptions: {
				plugins: [
					{
						name: 'vite-vue-internationalization/volar',
						primaryLocale: 'ja-JP',
						buildStrategy: 'inline-chunks',
						messageSyntax: 'icu',
						sfcTransform: 'all',
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
			messageSyntax: 'icu',
			sfcTransform: 'all',
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
		const root = mkdtempSync(join(tmpdir(), 'vite-vue-internationalization-'));
		writeFileSync(join(root, 'tsconfig.json'), `{
			// Vue Language Tools reads this block.
			"vueCompilerOptions": {
				"plugins": [
					{
						"name": "vite-vue-internationalization/volar",
						"primaryLocale": "ja-JP",
					},
				],
			},
		}`);

		expect(internals.resolveOptions(root, {})).toEqual({
			primaryLocale: 'ja-JP',
			buildStrategy: undefined,
			global: undefined,
			messageSyntax: 'vue',
			sfcTransform: 'locale-sources',
		});
	});

	it('prefers explicit Vite plugin options over tsconfig values', () => {
		const root = mkdtempSync(join(tmpdir(), 'vite-vue-internationalization-'));
		writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
			vueCompilerOptions: {
				plugins: [
					{
						name: 'vite-vue-internationalization/volar',
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
			messageSyntax: 'vue',
			sfcTransform: 'locale-sources',
		});
	});

	it('scans Vue files with include and exclude patterns', () => {
		const root = mkdtempSync(join(tmpdir(), 'vite-vue-internationalization-'));
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
		const root = mkdtempSync(join(tmpdir(), 'vite-vue-internationalization-'));
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

	it('resolves env dictionary paths outside the project root', () => {
		const root = mkdtempSync(join(tmpdir(), 'vite-vue-internationalization-'));
		const outside = join(root, '../outside.yaml');
		writeFileSync(outside, 'title: outside\n');

		expect(internals.loadLocaleEnvDictionary(root, 'ja-JP', '../outside.yaml')).toEqual({
			title: 'outside',
		});
	});

	it('rejects unsafe locale dictionary keys', () => {
		const root = mkdtempSync(join(tmpdir(), 'vite-vue-internationalization-'));
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

		expect(code).toContain('() => import("virtual:vite-vue-internationalization/locale/en-US")');
		expect(code).toContain('primaryLocale = "ja-JP"');
		expect(code).toContain('export const currentLocale = resolveInitialLocale();');
		expect(code).toContain('useDateTimeFormat');
		expect(code).toContain('useNumberFormat');
		expect(code).toContain('dateTimeFormats: options.dateTimeFormats');
		expect(code).toContain('numberFormats: options.numberFormats');
	});

	it('generates inline build runtime without dynamic locale imports', () => {
		const code = internals.generateInlineRuntimeModule('ja-JP', ['en-US', 'ja-JP']);

		expect(code).not.toContain('import("virtual:vite-vue-internationalization/locale/');
		expect(code).toContain('Promise.resolve({ global: {}, modules: {} })');
		expect(code).toContain('export const currentLocale = resolveInitialLocale();');
		expect(code).not.toContain('onLocaleChange');
	});

	it('generates locale-specific payload modules', () => {
		const code = internals.generateLocaleModule(
			'en-US',
			'ja-JP',
			{
				'/repo/src/App.vue': {
					'en-US': {
						hoge: 'foo',
					},
					'ja-JP': {
						hoge: 'ほげ',
						missingTranslation: '英語の翻訳がない',
					},
				},
			},
			{
				'en-US': {
					fuga: 'bar',
				},
				'ja-JP': {
					fallbackOnly: 'fallback',
				},
			},
		);

		expect(code).toContain('"hoge":"foo"');
		expect(code).toContain('"missingTranslation":"英語の翻訳がない"');
		expect(code).toContain('"fuga":"bar"');
		expect(code).toContain('"fallbackOnly":"fallback"');
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

	it('injects inline bindings for script-defined locale messages without locale blocks', () => {
		const output = internals.transformVueSfcInline([
			'<template>{{ $locale.sfc.title }}</template>',
			'<script setup lang="ts">',
			'import { defineInternationalization } from "vite-vue-internationalization";',
			'defineInternationalization({',
			'  "ja-JP": { title: "ほげ" },',
			'  "en-US": { title: "Title" },',
			'});',
			'</script>',
		].join('\n'), '/repo/src/App.vue', '/repo', 'ja-JP');

		expect(output).toContain('__VUE_INTERNATIONALIZATION_INLINE_LOCALE__');
		expect(output).toContain('__VUE_INTERNATIONALIZATION_INLINE_TEXT__');
		expect(output).toContain('$locale: __VUE_INTERNATIONALIZATION_INLINE_LOCALE__');
		expect(output).toContain('$l: __VUE_INTERNATIONALIZATION_INLINE_LOCALIZERS__');
	});

	it('injects inline bindings for SFCs without locale sources when enabled', () => {
		const output = internals.transformVueSfcInline([
			'<template>{{ $locale.env.title }}</template>',
			'<script setup lang="ts">',
			'const count = 1;',
			'</script>',
		].join('\n'), '/repo/src/App.vue', '/repo', 'ja-JP', true);

		expect(output).toContain('__VUE_INTERNATIONALIZATION_INLINE_TEXT__');
		expect(output).not.toContain('$locale: __VUE_INTERNATIONALIZATION_INLINE_LOCALE__');
		expect(output).not.toContain('const $locale = __VUE_INTERNATIONALIZATION_INLINE_LOCALE__');
	});

	it('does not inject inline bindings twice', () => {
		const output = internals.transformVueSfcInline([
			'<template>{{ $locale.env.title }}</template>',
			'<script setup lang="ts">',
			'const count = 1;',
			'</script>',
		].join('\n'), '/repo/src/App.vue', '/repo', 'ja-JP', true);

		expect(output).toBeDefined();
		expect(internals.transformVueSfcInline(output ?? '', '/repo/src/App.vue', '/repo', 'ja-JP', true)).toBe(output);
	});

	it('does not redeclare existing inline locale bindings', () => {
		const output = internals.transformVueSfcInline([
			'<template>{{ $locale.env.title }}</template>',
			'<script setup lang="ts">',
			'import { $locale, $l } from "@/i18n";',
			'</script>',
		].join('\n'), '/repo/src/App.vue', '/repo', 'ja-JP', true);

		expect(output).toContain('import { $locale, $l } from "@/i18n";');
		expect(output).not.toContain('const $locale = __VUE_INTERNATIONALIZATION_INLINE_LOCALE__');
		expect(output).not.toContain('const $l = __VUE_INTERNATIONALIZATION_INLINE_LOCALIZERS__');
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

	it('ignores non-marker calls with inline helper names', () => {
		const code = [
			'const locale = __VUE_INTERNATIONALIZATION_INLINE_LOCALE__("not-a-marker");',
			'const localizers = __VUE_INTERNATIONALIZATION_INLINE_LOCALIZERS__("not-a-marker");',
			'const text = __VUE_INTERNATIONALIZATION_INLINE_TEXT__("not-a-marker", "sfc.title");',
			'const value = localizers.sfc.title({});',
		].join('');

		const replaced = internals.replaceInlineLocaleMemberAccess(
			code,
			'ja-JP',
			'ja-JP',
			{},
			{},
		);

		expect(replaced).toBe(code);
	});

	it('replaces script localizer calls from inline localizer bindings', () => {
		const marker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue');
		const binding = marker.match(/const \$l = (.*);/)?.[1];
		const code = [
			`const l = ${binding};`,
			'const apples = l.sfc.nApples({ n });',
			'const refApples = l.value.sfc.nApples({ n: count });',
			'const computedApples = l.sfc.nApples({ n: Math.max(count, 1) });',
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

		expect(replaced).toContain('const apples = ((__values) => ((typeof __values === "number" ? (__values) : __values?.["n"]) ?? "{n}") + " apples")({ n });');
		expect(replaced).toContain('const refApples = ((__values) => ((typeof __values === "number" ? (__values) : __values?.["n"]) ?? "{n}") + " apples")({ n: count });');
		expect(replaced).toContain('const computedApples = ((__values) => ((typeof __values === "number" ? (__values) : __values?.["n"]) ?? "{n}") + " apples")({ n: Math.max(count, 1) });');
		expect(replaced).toContain('const missing = "$locale.sfc.missing";');
	});

	it('preserves message functions in virtual and inline localizer output', () => {
		const message = (values?: { name?: string }) => `Hello ${values?.name ?? 'there'}`;
		const localeModule = internals.generateLocaleModule(
			'en-US',
			'en-US',
			{},
			{
				'en-US': {
					message,
				},
			},
		);

		expect(localeModule).toContain('"message":((values');

		const marker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue');
		const binding = marker.match(/const \$l = (.*);/)?.[1];
		const code = `const l = ${binding};const value = l.env.message({ name });`;
		const replaced = internals.replaceInlineLocalizerAccess(
			code,
			'en-US',
			'en-US',
			{},
			{
				'en-US': {
					message,
				},
			},
		);

		expect(replaced).toContain('const value = (((values');
		expect(replaced).toContain(')({ name }));');
	});

	it('resolves linked messages in inline localizer calls', () => {
		const marker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue');
		const binding = marker.match(/const \$l = (.*);/)?.[1];
		const code = [
			`const l = ${binding};`,
			'const relative = l.sfc.linked({ count });',
			'const env = l.sfc.linkedEnv({ count });',
			'const sfc = l.sfc.linkedSfc({ count });',
			'const recursive = l.sfc.recursive({ count });',
		].join('');

		const replaced = internals.replaceInlineLocalizerAccess(
			code,
			'en-US',
			'ja-JP',
			{
				'/src/App.vue': {
					'en-US': {
						name: 'World {count}',
						linked: 'Hello @.lower:name',
						linkedEnv: 'From @:env.appName',
						linkedSfc: 'From @:sfc.name',
						recursive: '@:recursive',
					},
				},
			},
			{
				'en-US': {
					appName: 'Example {count}',
				},
			},
		);

		expect(replaced).toContain('const relative = ((__values) => "Hello " + ((((__values) => "World " + ((typeof __values === "number" ? (__values) : __values?.["count"]) ?? "{count}"))(__values)).toLocaleLowerCase()))({ count });');
		expect(replaced).toContain('const env = ((__values) => "From " + ((__values) => "Example " + ((typeof __values === "number" ? (__values) : __values?.["count"]) ?? "{count}"))(__values))({ count });');
		expect(replaced).toContain('const sfc = ((__values) => "From " + ((__values) => "World " + ((typeof __values === "number" ? (__values) : __values?.["count"]) ?? "{count}"))(__values))({ count });');
		expect(replaced).toContain('const recursive = ((__values) => ((__values) => "@:recursive")(__values))({ count });');
	});

	it('replaces ICU messageformat inline localizer calls', () => {
		const marker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue');
		const binding = marker.match(/const \$l = (.*);/)?.[1];
		const code = [
			`const l = ${binding};`,
			'const plural = l.sfc.icuPlural({ count });',
			'const select = l.sfc.icuSelect({ gender, count });',
		].join('');

		const replaced = internals.replaceInlineLocalizerAccess(
			code,
			'en-US',
			'en-US',
			{
				'/src/App.vue': {
					'en-US': {
						icuPlural: '{count, plural, =0 {no apples} one {one apple} other {# apples}}',
						icuSelect: '{gender, select, female {She has {count, plural, one {one apple} other {# apples}}} other {They have {count, plural, one {one apple} other {# apples}}}}',
					},
				},
			},
			{},
			'icu',
		);

		expect(replaced).toContain('new Intl.PluralRules("en-US"');
		expect(replaced).toContain('"female":()=>');
		expect(replaced).not.toContain('one {one apple}');
	});

	it('rewrites template locale access to inline text markers', () => {
		const code = internals.rewriteInlineLocaleTemplateAccess(
			'<template><p>{{ $locale.sfc.title }}</p><p>{{ $locale.env.missing }}</p><p>{{ $l.sfc.nApples({ n: Math.max(n, 1) }) }}</p></template>',
			'/src/App.vue',
		);

		expect(code).toContain('__VUE_INTERNATIONALIZATION_INLINE_TEXT__');
		expect(code).toContain('__VUE_INTERNATIONALIZATION_INLINE_LOCALIZER__');
		expect(code).toContain('&quot;sfc.title&quot;');
		expect(code).toContain('&quot;env.missing&quot;');
		expect(code).toContain('&quot;sfc.nApples&quot;');
		expect(code).toContain('Math.max(n, 1)');
	});

	it('rewrites template attribute locale access without breaking quoted attributes', () => {
		const code = internals.rewriteInlineLocaleTemplateAccess(
			'<template><button :title="$locale.sfc.title" :aria-label="$l.sfc.nApples({ n: Math.max(n, 1) })">x</button></template>',
			'/src/App.vue',
		);
		const compiled = compileTemplate({ source: code, filename: '/src/App.vue', id: 'test' });

		expect(compiled.errors).toEqual([]);
		expect(compiled.code).toContain('_ctx.__VUE_INTERNATIONALIZATION_INLINE_TEXT__("__VUE_INTERNATIONALIZATION_INLINE__:L3NyYy9BcHAudnVl","sfc.title")');
		expect(compiled.code).toContain('_ctx.__VUE_INTERNATIONALIZATION_INLINE_LOCALIZER__("__VUE_INTERNATIONALIZATION_INLINE__:L3NyYy9BcHAudnVl","sfc.nApples",{ n: Math.max(_ctx.n, 1) })');
	});

	it('rewrites locale access after nested template slots', () => {
		const code = internals.rewriteInlineLocaleTemplateAccess([
			'<template>',
			'  <Panel>',
			'    <template #label>{{ $locale.env.label }}</template>',
			'    <span>{{ $locale.env.afterSlot }}</span>',
			'  </Panel>',
			'</template>',
		].join('\n'), '/src/App.vue');

		expect(code).toContain('&quot;env.label&quot;');
		expect(code).toContain('&quot;env.afterSlot&quot;');
		expect(code).not.toContain('$locale.env.label');
		expect(code).not.toContain('$locale.env.afterSlot');
	});

	it('rewrites locale access before method calls without consuming the method name', () => {
		const code = internals.rewriteInlineLocaleTemplateAccess(
			'<template><div v-html="$locale.env.description.replaceAll(\'\\n\', \'<br>\')"></div></template>',
			'/src/App.vue',
		);
		const compiled = compileTemplate({ source: code, filename: '/src/App.vue', id: 'test' });
		const replaced = internals.replaceInlineLocaleMarkers(
			compiled.code,
			'ja-JP',
			'ja-JP',
			'vue',
			{},
			{
				'ja-JP': {
					description: 'line 1\nline 2',
				},
			},
		);

		expect(code).toContain('&quot;env.description&quot;');
		expect(code).toContain('.replaceAll');
		expect(replaced).toContain('"line 1\\nline 2".replaceAll');
		expect(replaced).not.toContain('$locale.env.description.replaceAll');
	});

	it('rewrites static computed locale access', () => {
		const code = internals.rewriteInlineLocaleTemplateAccess(
			'<template><p>{{ $locale.env[`2fa`] }} {{ $locale.env["token"] }} {{ $locale.env[\'password\'] }}</p></template>',
			'/src/App.vue',
		);
		const compiled = compileTemplate({ source: code, filename: '/src/App.vue', id: 'test' });
		const replaced = internals.replaceInlineLocaleMarkers(
			compiled.code,
			'ja-JP',
			'ja-JP',
			'vue',
			{},
			{
				'ja-JP': {
					'2fa': '二要素認証',
					token: 'トークン',
					password: 'パスワード',
				},
			},
		);

		expect(code).toContain('&quot;env.2fa&quot;');
		expect(code).toContain('&quot;env.token&quot;');
		expect(code).toContain('&quot;env.password&quot;');
		expect(replaced).not.toContain('$locale.env');
	});

	it('rewrites dynamic computed locale access to subtree lookups', () => {
		const code = internals.rewriteInlineLocaleTemplateAccess(
			'<template><p>{{ $locale.env._permissions[p] ?? p }}</p><p>{{ $locale.env._achievements._types[`_${achievement}`].title }}</p></template>',
			'/src/App.vue',
		);
		const compiled = compileTemplate({ source: code, filename: '/src/App.vue', id: 'test' });
		const replaced = internals.replaceInlineLocaleMarkers(
			compiled.code,
			'ja-JP',
			'ja-JP',
			'vue',
			{},
			{
				'ja-JP': {
					_permissions: {
						read: '読む',
						write: '書く',
					},
					_achievements: {
						_types: {
							_login: {
								title: 'ログイン',
								description: 'ログインした',
							},
						},
					},
				},
			},
		);

		expect(code).toContain('__VUE_INTERNATIONALIZATION_INLINE_LOOKUP__');
		expect(replaced).toContain('"read":"読む"');
		expect(replaced).toContain('"write":"書く"');
		expect(replaced).toContain('"_login":"ログイン"');
		expect(replaced).not.toContain('__VUE_INTERNATIONALIZATION_INLINE_');
		expect(replaced).not.toContain('$locale.env');
	});

	it('rewrites locale-only SFC static access in scripts and templates for inline chunks', () => {
		const root = mkdtempSync(join(tmpdir(), 'vite-vue-internationalization-'));
		mkdirSync(join(root, 'src'), { recursive: true });
		writeFileSync(join(root, 'src/messages.vue'), [
			'<locale locale="ja-JP" lang="yaml">',
			'title: タイトル',
			'body: 本文',
			'</locale>',
		].join('\n'));
		const code = internals.rewriteInlineComponentLocaleAccess([
			'<script setup lang="ts">',
			'import Messages from "./messages.vue";',
			'const title = Messages.$locale.title;',
			'const body = Messages.$l.body({ source: "script" });',
			'</script>',
			'<template>',
			'  <p>{{ Messages.$locale.title }}</p>',
			'  <p>{{ Messages.$l.body({ source: "template" }) }}</p>',
			'</template>',
		].join('\n'), join(root, 'src/App.vue'), root);

		expect(code).toContain('__VUE_INTERNATIONALIZATION_INLINE_TEXT__("__VUE_INTERNATIONALIZATION_INLINE__:L3NyYy9tZXNzYWdlcy52dWU=","sfc.title")');
		expect(code).toContain('__VUE_INTERNATIONALIZATION_INLINE_LOCALIZER__("__VUE_INTERNATIONALIZATION_INLINE__:L3NyYy9tZXNzYWdlcy52dWU=","sfc.body",{ source: "script" })');
		expect(code).toContain('__VUE_INTERNATIONALIZATION_INLINE_TEXT__(&quot;__VUE_INTERNATIONALIZATION_INLINE__:L3NyYy9tZXNzYWdlcy52dWU=&quot;,&quot;sfc.title&quot;)');
		expect(code).toContain('__VUE_INTERNATIONALIZATION_INLINE_LOCALIZER__(&quot;__VUE_INTERNATIONALIZATION_INLINE__:L3NyYy9tZXNzYWdlcy52dWU=&quot;,&quot;sfc.body&quot;,{ source: "template" })');
	});

	it('replaces locale-only SFC static access markers with localized values', () => {
		const root = mkdtempSync(join(tmpdir(), 'vite-vue-internationalization-'));
		mkdirSync(join(root, 'src'), { recursive: true });
		writeFileSync(join(root, 'src/messages.vue'), [
			'<locale locale="ja-JP" lang="yaml">',
			'title: タイトル',
			'body: 本文',
			'</locale>',
		].join('\n'));
		const code = internals.rewriteInlineComponentLocaleAccess([
			'import Messages from "./messages.vue";',
			'const title = Messages.$locale.title;',
			'const titleText = Messages.$l.title();',
			'const body = Messages.$l.body({ source });',
		].join('\n'), join(root, 'src/App.vue'), root);
		const replaced = internals.replaceInlineLocaleMarkers(
			code,
			'en-US',
			'ja-JP',
			'vue',
			{
				'/src/messages.vue': {
					'ja-JP': {
						title: 'タイトル',
					},
					'en-US': {
						title: 'Title',
						body: 'From {source}',
					},
				},
			},
			{},
		);

		expect(replaced).toContain('const title = "Title";');
		expect(replaced).toContain('const titleText = "Title";');
		expect(replaced).toContain('const body = ((__values) => "From " + ((typeof __values === "number" ? (undefined) : __values?.["source"]) ?? "{source}"))({ source });');
		expect(replaced).not.toContain('Messages.$locale');
		expect(replaced).not.toContain('Messages.$l');
	});

	it('replaces inline marker calls with template literal arguments', () => {
		const marker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue').match(/"(__VUE_INTERNATIONALIZATION_INLINE__:[^"]+)"/)?.[1];
		const code = [
			`const title = ctx.__VUE_INTERNATIONALIZATION_INLINE_TEXT__(\`${marker}\`, \`env.title\`);`,
			`const body = ctx.__VUE_INTERNATIONALIZATION_INLINE_LOCALIZER__(\`${marker}\`, \`env.body\`, { count: 2 });`,
		].join('\n');
		const replaced = internals.replaceInlineLocaleMarkers(
			code,
			'ja-JP',
			'ja-JP',
			'vue',
			{},
			{
				'ja-JP': {
					title: 'タイトル',
					body: '{count} 件',
				},
			},
		);

		expect(replaced).toContain('const title = "タイトル";');
		expect(replaced).toContain('" 件"');
		expect(replaced).not.toContain('__VUE_INTERNATIONALIZATION_INLINE_');
	});

	it('replaces inline marker calls nested in localizer values', () => {
		const marker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue').match(/"(__VUE_INTERNATIONALIZATION_INLINE__:[^"]+)"/)?.[1];
		const code = `const body = ctx.__VUE_INTERNATIONALIZATION_INLINE_LOCALIZER__(\`${marker}\`, \`env.body\`, { ok: ctx.__VUE_INTERNATIONALIZATION_INLINE_TEXT__(\`${marker}\`, \`env.ok\`) });`;
		const replaced = internals.replaceInlineLocaleMarkers(
			code,
			'ja-JP',
			'ja-JP',
			'vue',
			{},
			{
				'ja-JP': {
					body: '[{ok}] をクリックしてください',
					ok: 'OK',
				},
			},
		);

		expect(replaced).toContain('ok: "OK"');
		expect(replaced).not.toContain('__VUE_INTERNATIONALIZATION_INLINE_');
	});

	it('does not rewrite static access for component SFC imports with script setup', () => {
		const root = mkdtempSync(join(tmpdir(), 'vite-vue-internationalization-'));
		mkdirSync(join(root, 'src'), { recursive: true });
		writeFileSync(join(root, 'src/Panel.vue'), [
			'<script setup lang="ts">',
			'console.log("keep component side effects");',
			'</script>',
			'<locale locale="ja-JP" lang="yaml">',
			'title: タイトル',
			'</locale>',
		].join('\n'));
		const input = [
			'import Panel from "./Panel.vue";',
			'const title = Panel.$locale.title;',
		].join('\n');
		const code = internals.rewriteInlineComponentLocaleAccess(input, join(root, 'src/App.vue'), root);

		expect(code).toBe(input);
	});

	it('replaces compiled template attribute locale markers', () => {
		const code = internals.rewriteInlineLocaleTemplateAccess(
			'<template><button :title="$locale.sfc.title" :aria-label="$l.sfc.nApples({ n: Math.max(n, 1) })">x</button></template>',
			'/src/App.vue',
		);
		const compiled = compileTemplate({ source: code, filename: '/src/App.vue', id: 'test' });
		const replacedText = internals.replaceInlineLocaleTextAccess(
			compiled.code,
			'ja-JP',
			'ja-JP',
			{
				'/src/App.vue': {
					'ja-JP': {
						title: 'タイトル',
						nApples: '{n} 個のりんご',
					},
				},
			},
			{},
		);
		const replaced = internals.replaceInlineLocalizerAccess(
			replacedText,
			'ja-JP',
			'ja-JP',
			{
				'/src/App.vue': {
					'ja-JP': {
						title: 'タイトル',
						nApples: '{n} 個のりんご',
					},
				},
			},
			{},
		);

		expect(replaced).toContain('title: "タイトル"');
		expect(replaced).toContain('" 個のりんご"');
		expect(replaced).not.toContain('__VUE_INTERNATIONALIZATION_INLINE_TEXT__');
		expect(replaced).not.toContain('__VUE_INTERNATIONALIZATION_INLINE_LOCALIZER__');
	});

	it('throws on invalid JavaScript during full inline chunk replacement', () => {
		expect(() => internals.inlineLocaleChunks(
			{
				'assets/App.js': {
					type: 'chunk',
					fileName: 'assets/App.js',
					code: `const broken = ; __VUE_INTERNATIONALIZATION_INLINE_LOCALE__(${JSON.stringify(internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue').match(/"(__VUE_INTERNATIONALIZATION_INLINE__:[^"]+)"/)?.[1])});`,
					imports: [],
					dynamicImports: [],
				},
			},
			['ja-JP'],
			'ja-JP',
			{},
			{},
		)).toThrow();
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

	it('rewrites preload dependency references between localized chunks', () => {
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
				code: `const msg = ${appCode}; preload(() => import("./AsyncPanel.js"), ["AsyncPanel.js"]);`,
				imports: [],
				dynamicImports: [],
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

		expect(bundle['assets/App.ja-JP.js'].code).toContain('"AsyncPanel.ja-JP.js"');
		expect(bundle['assets/App.en-US.js'].code).toContain('"AsyncPanel.en-US.js"');
		expect(bundle['assets/App.ja-JP.js'].code).not.toContain('"AsyncPanel.js"');
		expect(bundle['assets/App.en-US.js'].code).not.toContain('"AsyncPanel.js"');
	});

	it('can emit localized chunks without assigning to the output bundle', () => {
		const marker = internals.injectInlineLocaleBinding('<script setup></script>', '/src/App.vue');
		const code = marker.match(/const \$locale = (.*);/)?.[1];
		const emitted: Array<{ fileName: string; code: string }> = [];
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
				code: `const msg = ${code};`,
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
					'ja-JP': { title: 'ほげ' },
					'en-US': { title: 'Title' },
				},
			},
			{},
			'vue',
			{
				emitChunk: chunk => emitted.push({
					fileName: chunk.fileName,
					code: chunk.code,
				}),
			},
		);

		expect(bundle['assets/App.js']).toBeUndefined();
		expect(emitted.map(chunk => chunk.fileName).sort()).toEqual([
			'assets/App.en-US.js',
			'assets/App.ja-JP.js',
		]);
		expect(emitted.find(chunk => chunk.fileName.endsWith('.en-US.js'))?.code).toContain('"title":"Title"');
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
					file: 'assets/App-abc.js',
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

	it('augments css-only vite manifest entries by facade module id', () => {
		const manifest = internals.augmentViteManifestJson(
			JSON.stringify({
				'src/main.ts': {
					file: 'assets/main.css',
					src: 'src/main.ts',
				},
			}),
			{
				primaryLocale: 'ja-JP',
				entries: [
					{
						fileName: 'assets/App-abc.ja-JP.js',
						originalFileName: 'assets/App-abc.js',
						facadeModuleId: '/project/src/main.ts',
						locales: {
							'ja-JP': 'assets/App-abc.ja-JP.js',
							'en-US': 'assets/App-abc.en-US.js',
						},
					},
				],
			},
		);
		const parsed = JSON.parse(manifest);

		expect(parsed['src/main.ts'].file).toBe('assets/App-abc.ja-JP.js');
		expect(parsed['src/main.ts'].css).toEqual(['assets/main.css']);
		expect(parsed['src/main.ts'].isEntry).toBe(true);
		expect(parsed['src/main.ts'].internationalization.locales['en-US']).toBe('assets/App-abc.en-US.js');
		expect(parsed['src/main.ts?locale=en-US'].file).toBe('assets/App-abc.en-US.js');
		expect(parsed['src/main.ts?locale=en-US'].css).toEqual(['assets/main.css']);
	});
});
