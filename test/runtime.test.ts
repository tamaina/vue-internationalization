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
				global: Record<string, unknown>;
				module: Record<string, Record<string, unknown> | string>;
			};
		};
		const moduleMessages = locale.value.module;

		expect(moduleMessages.title).toBe('foo');
		expect(locale.value.global.fuga).toBe('ふが');
		expect((moduleMessages.nested as Record<string, unknown>).value).toBe('primary');
		expect(locale.value.module.missing).toBe('$locale.module.missing');
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
				module: {
					nApples: (values: { n: number }) => string;
					nOranges: (values: { n: number }) => string;
				};
			};
		};

		expect(localizer.value.module.nApples({ n: 3 })).toBe('3 apples');
		expect(localizer.value.module.nOranges({ n: 4 })).toBe('4 個のみかん');
	});

	it('keeps unresolved template parameters visible', () => {
		expect(formatLocaleTemplate('Hello {name}', {})).toBe('Hello {name}');
	});
});
