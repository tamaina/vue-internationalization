import { describe, expect, it } from 'vitest';
import { createInternationalization, formatLocaleTemplate, setActiveInternationalization, useLocale, useLocalizer } from '../src/runtime.js';

describe('runtime locale fallback', () => {
	it('falls back to the primary locale and then the full locale expression', async () => {
		const internationalization = createInternationalization({
			primaryLocale: 'ja-JP',
			initialLocale: 'en-US',
			loaders: {
				'en-US': () =>
					Promise.resolve({
						global: {},
						modules: {
							'/src/App.vue': {
								title: 'foo',
							},
						},
					}),
				'ja-JP': () =>
					Promise.resolve({
						global: {
							fuga: 'ふが',
						},
						modules: {
							'/src/App.vue': {
								title: 'ほげ',
								nested: {
									value: 'primary',
								},
							},
						},
					}),
			},
		});

		await internationalization.ready;
		await internationalization.loadLocale('ja-JP');
		setActiveInternationalization(internationalization);

		const locale = useLocale('/src/App.vue') as unknown as {
			value: {
				env: Record<string, unknown>;
				sfc: Record<string, Record<string, unknown> | string>;
			};
		};
		const moduleMessages = locale.value.sfc;

		expect(moduleMessages.title).toBe('foo');
		expect(locale.value.env.fuga).toBe('ふが');
		expect((moduleMessages.nested as Record<string, unknown>).value).toBe('primary');
		expect(locale.value.sfc.missing).toBe('$locale.sfc.missing');
	});

	it('formats localizer templates with fallback locale values', async () => {
		const internationalization = createInternationalization({
			primaryLocale: 'ja-JP',
			initialLocale: 'en-US',
			loaders: {
				'en-US': () =>
					Promise.resolve({
						modules: {
							'/src/App.vue': {
								nApples: '{n} apples',
							},
						},
					}),
				'ja-JP': () =>
					Promise.resolve({
						modules: {
							'/src/App.vue': {
								nApples: '{n} 個のりんご',
								nOranges: '{n} 個のみかん',
							},
						},
					}),
			},
		});

		await internationalization.ready;
		await internationalization.loadLocale('ja-JP');
		setActiveInternationalization(internationalization);

		const localizer = useLocalizer('/src/App.vue') as unknown as {
			value: {
				sfc: {
					nApples: (values: { n: number }) => string;
					nOranges: (values: { n: number }) => string;
				};
			};
		};

		expect(localizer.value.sfc.nApples({ n: 3 })).toBe('3 apples');
		expect(localizer.value.sfc.nOranges({ n: 4 })).toBe('4 個のみかん');
	});

	it('keeps unresolved template parameters visible', () => {
		expect(formatLocaleTemplate('Hello {name}', {})).toBe('Hello {name}');
	});

	it('formats vue-i18n compatible message syntax', async () => {
		const internationalization = createInternationalization({
			primaryLocale: 'en-US',
			loaders: {
				'en-US': () =>
					Promise.resolve({
						global: {
							appName: 'Example App',
							nested: {
								envTarget: 'env target',
							},
						},
						modules: {
							'/src/App.vue': {
								named: 'Hello {user-name}',
								list: '{0} world',
								literal: '{\'hello\'} world',
								car: 'car | cars',
								apple: 'no apples | one apple | {count} apples',
								name: 'World',
								linked: 'Hello @.lower:name',
								linkedEnv: 'From @:env.appName',
								linkedSfc: 'From @:sfc.name',
								nestedEnv: '@.capitalize:env.nested.envTarget',
								missingLinked: 'Missing @:missing.path',
								recursive: '@:recursive',
								nested: {
									target: 'nested target',
									linked: '@.capitalize:nested.target',
								},
							},
						},
					}),
			},
		});

		await internationalization.ready;
		setActiveInternationalization(internationalization);

		const localizer = useLocalizer('/src/App.vue') as unknown as {
			value: {
				sfc: {
					named: (values: { 'user-name': string }) => string;
					list: (values: string[]) => string;
					literal: () => string;
					car: (plural: number) => string;
					apple: (values: { count: number }, plural?: number) => string;
					linked: () => string;
					linkedEnv: () => string;
					linkedSfc: () => string;
					nestedEnv: () => string;
					missingLinked: () => string;
					recursive: () => string;
					nested: {
						linked: () => string;
					};
				};
			};
		};

		expect(localizer.value.sfc.named({ 'user-name': 'Jane' })).toBe('Hello Jane');
		expect(localizer.value.sfc.list(['hello'])).toBe('hello world');
		expect(localizer.value.sfc.literal()).toBe('hello world');
		expect(localizer.value.sfc.car(1)).toBe('car');
		expect(localizer.value.sfc.car(2)).toBe('cars');
		expect(localizer.value.sfc.apple({ count: 0 }, 0)).toBe('no apples');
		expect(localizer.value.sfc.apple({ count: 1 }, 1)).toBe('one apple');
		expect(localizer.value.sfc.apple({ count: 10 }, 10)).toBe('10 apples');
		expect(localizer.value.sfc.linked()).toBe('Hello world');
		expect(localizer.value.sfc.linkedEnv()).toBe('From Example App');
		expect(localizer.value.sfc.linkedSfc()).toBe('From World');
		expect(localizer.value.sfc.nestedEnv()).toBe('Env target');
		expect(localizer.value.sfc.missingLinked()).toBe('Missing @:missing.path');
		expect(localizer.value.sfc.recursive()).toBe('@:recursive');
		expect(localizer.value.sfc.nested.linked()).toBe('Nested target');
	});
});
